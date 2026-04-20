/**
 * Docs-Generator - 项目文档/采购报告/PCB报告 生成器
 */

const PLUGIN_TAG = '[Docs-Generator]';

// eslint-disable-next-line unused-imports/no-unused-vars
export function activate(_status?: 'onStartupFinished', _arg?: string): void {}

interface ComponentInfo {
	designator: string;
	name: string;
	manufacturer: string;
	manufacturerId: string;
	supplier: string;
	supplierId: string;
	footprint: string;
	otherProperty: Record<string, string | number | boolean>;
}

interface PageData {
	pageName: string;
	pageUuid: string;
	components: ComponentInfo[];
	imageBase64: string;
}

/**
 * 生成项目文档（原理图编辑器入口）
 */
export async function generateDoc(): Promise<void> {
	try {
		const docInfo = await eda.dmt_SelectControl.getCurrentDocumentInfo();
		if (!docInfo) {
			eda.sys_Dialog.showInformationMessage('请先打开一个原理图页面', 'Docs-Generator');
			return;
		}

		let projectName = '';
		try {
			const projectInfo = await eda.dmt_Project.getCurrentProjectInfo();
			if (projectInfo)
				projectName = projectInfo.friendlyName || projectInfo.name || '';
		}
		catch (_) {}

		let boardName = '';
		try {
			const boardInfo = await eda.dmt_Board.getCurrentBoardInfo();
			if (boardInfo)
				boardName = boardInfo.name || '';
		}
		catch (_) {}

		let allPages: Array<{ name: string; uuid: string }> = [];
		try {
			const pages = await eda.dmt_Schematic.getCurrentSchematicAllSchematicPagesInfo();
			if (pages && pages.length > 0)
				allPages = pages.map(p => ({ name: p.name, uuid: p.uuid }));
		}
		catch (_) {}

		if (allPages.length === 0) {
			try {
				const currentPage = await eda.dmt_Schematic.getCurrentSchematicPageInfo();
				if (currentPage)
					allPages = [{ name: currentPage.name, uuid: currentPage.uuid }];
			}
			catch (_) {}
		}

		if (allPages.length === 0) {
			eda.sys_Dialog.showInformationMessage('未找到原理图页', 'Docs-Generator');
			return;
		}

		const originalTabId = docInfo.tabId;
		const pagesData: PageData[] = [];

		for (const page of allPages) {
			try { await eda.dmt_EditorControl.openDocument(page.uuid); await delay(500); }
			catch (_) { continue; }

			let components: any[] = [];
			try { components = await eda.sch_PrimitiveComponent.getAll('part' as any, false); }
			catch (_) {}

			const componentList: ComponentInfo[] = [];
			if (components && components.length > 0) {
				for (const comp of components) {
					const designator = comp.getState_Designator() || '';
					const rawName = comp.getState_Name() || '';
					const manufacturer = comp.getState_Manufacturer() || '';
					const manufacturerId = comp.getState_ManufacturerId() || '';
					const supplier = comp.getState_Supplier() || '';
					const supplierId = comp.getState_SupplierId() || '';
					const fp = comp.getState_Footprint();
					const footprint = fp ? fp.uuid : '';
					const otherProperty = comp.getState_OtherProperty() || {};
					const name = resolvePropertyRef(rawName, otherProperty);
					if (!designator || designator.endsWith('?')) continue;
					componentList.push({ designator, name, manufacturer, manufacturerId, supplier, supplierId, footprint, otherProperty });
				}
			}

			let imageBase64 = '';
			try {
				await eda.dmt_EditorControl.zoomToAllPrimitives();
				await delay(300);
				const imageBlob = await eda.dmt_EditorControl.getCurrentRenderedAreaImage();
				if (imageBlob) imageBase64 = await blobToBase64(imageBlob);
			}
			catch (_) {}

			pagesData.push({ pageName: page.name, pageUuid: page.uuid, components: componentList, imageBase64 });
		}

		try { await eda.dmt_EditorControl.activateDocument(originalTabId); } catch (_) {}

		if (pagesData.length === 0 || pagesData.every(p => p.components.length === 0)) {
			eda.sys_Dialog.showInformationMessage('未找到有效器件', 'Docs-Generator');
			return;
		}

		try {
			await eda.sys_Storage.setExtensionUserConfig('prodoc_data', JSON.stringify({
				projectName, boardName, pages: pagesData, timestamp: Date.now(),
			}));
		}
		catch (storageErr) {
			console.error(PLUGIN_TAG, 'Storage failed:', storageErr);
			try {
				const existing = eda.sys_Storage.getExtensionAllUserConfigs() || {};
				existing['prodoc_data'] = JSON.stringify({ projectName, boardName, pages: pagesData, timestamp: Date.now() });
				await eda.sys_Storage.setExtensionAllUserConfigs(existing);
			}
			catch (e2) { eda.sys_Dialog.showInformationMessage('数据存储失败', 'Docs-Generator'); return; }
		}

		await eda.sys_IFrame.openIFrame('/iframe/index.html', 900, 700, 'prodoc-main', {
			title: 'Docs-Generator - 项目文档生成器', maximizeButton: true, minimizeButton: true,
		});
	}
	catch (err) {
		console.error(PLUGIN_TAG, 'Failed to generate document:', err);
		eda.sys_Dialog.showInformationMessage('文档生成失败', 'Docs-Generator');
	}
}

/**
 * 生成采购报告
 */
export async function generateProcurement(): Promise<void> {
	try {
		const docInfo = await eda.dmt_SelectControl.getCurrentDocumentInfo();
		if (!docInfo) { eda.sys_Dialog.showInformationMessage('请先打开一个原理图页面', 'Docs-Generator'); return; }

		let projectName = '';
		try { const p = await eda.dmt_Project.getCurrentProjectInfo(); if (p) projectName = p.friendlyName || p.name || ''; } catch (_) {}

		let boardName = '';
		try { const b = await eda.dmt_Board.getCurrentBoardInfo(); if (b) boardName = b.name || ''; } catch (_) {}

		let bomCsv = '';
		try { const f = await eda.sch_ManufactureData.getBomFile('BOM_Export', 'csv'); if (f) bomCsv = await f.text(); }
		catch (err) { console.error(PLUGIN_TAG, 'Failed to get BOM:', err); }

		if (!bomCsv) { eda.sys_Dialog.showInformationMessage('无法获取 BOM 数据', 'Docs-Generator'); return; }

		try {
			await eda.sys_Storage.setExtensionUserConfig('prodoc_procurement', JSON.stringify({ projectName, boardName, bomCsv, timestamp: Date.now() }));
		}
		catch (storageErr) {
			console.error(PLUGIN_TAG, 'Storage failed, trying alternative:', storageErr);
			// Fallback: try setExtensionAllUserConfigs
			try {
				const existing = eda.sys_Storage.getExtensionAllUserConfigs() || {};
				existing['prodoc_procurement'] = JSON.stringify({ projectName, boardName, bomCsv, timestamp: Date.now() });
				await eda.sys_Storage.setExtensionAllUserConfigs(existing);
			}
			catch (e2) {
				console.error(PLUGIN_TAG, 'All storage methods failed:', e2);
				eda.sys_Dialog.showInformationMessage('数据存储失败，请确保扩展已正确安装。', 'Docs-Generator');
				return;
			}
		}
		await eda.sys_IFrame.openIFrame('/iframe/procurement.html', 950, 700, 'prodoc-procurement', { title: '采购报告', maximizeButton: true, minimizeButton: true });
	}
	catch (err) { console.error(PLUGIN_TAG, 'Procurement failed:', err); eda.sys_Dialog.showInformationMessage('采购报告生成失败', 'Docs-Generator'); }
}

/**
 * 生成 PCB 设计报告
 */
export async function generatePcbReport(): Promise<void> {
	try {
		const docInfo = await eda.dmt_SelectControl.getCurrentDocumentInfo();
		if (!docInfo) { eda.sys_Dialog.showInformationMessage('请先打开一个 PCB 页面', 'Docs-Generator'); return; }

		let projectName = '';
		try { const p = await eda.dmt_Project.getCurrentProjectInfo(); if (p) projectName = p.friendlyName || p.name || ''; } catch (_) {}

		let boardName = '';
		try { const b = await eda.dmt_Board.getCurrentBoardInfo(); if (b) boardName = b.name || ''; } catch (_) {}

		let layers: Array<{ name: string; type: string; visible: boolean }> = [];
		try {
			const allLayers = await eda.pcb_Layer.getAllLayers();
			if (allLayers) layers = allLayers.map((l: any) => ({ name: l.name || '', type: l.type || '', visible: l.visible !== false }));
		} catch (_) {}

		let componentCount = 0;
		try { const ids = await eda.pcb_PrimitiveComponent.getAllPrimitiveId(); componentCount = ids ? ids.length : 0; } catch (_) {}

		let netNames: string[] = [];
		try { netNames = await eda.pcb_Net.getAllNetsName(); } catch (_) {}

		let drcPassed = true;
		let drcErrors: any[] = [];
		try { drcErrors = await eda.pcb_Drc.check(true, false, true); drcPassed = !drcErrors || drcErrors.length === 0; } catch (_) {}

		let pickPlaceCsv = '';
		try { const f = await eda.pcb_ManufactureData.getPickAndPlaceFile('PickPlace', 'csv'); if (f) pickPlaceCsv = await f.text(); } catch (_) {}

		let pcbInfoText = '';
		try { const f = await eda.pcb_ManufactureData.getPcbInfoFile('PCBInfo'); if (f) pcbInfoText = await f.text(); } catch (_) {}

		// Get trace count per layer and total
		let traceCount = 0;
		const tracesPerLayer: Record<string, number> = {};
		try {
			const allTraces = await eda.pcb_PrimitiveLine.getAll();
			if (allTraces) {
				traceCount = allTraces.length;
				for (const t of allTraces) {
					const layer = String(t.getState_Layer ? t.getState_Layer() : '');
					tracesPerLayer[layer] = (tracesPerLayer[layer] || 0) + 1;
				}
			}
		}
		catch (_) {}

		// Get via count and details
		let viaCount = 0;
		try { const ids = await eda.pcb_PrimitiveVia.getAllPrimitiveId(); viaCount = ids ? ids.length : 0; } catch (_) {}

		// Get arc count
		let arcCount = 0;
		try { const ids = await eda.pcb_PrimitiveArc.getAllPrimitiveId(); arcCount = ids ? ids.length : 0; } catch (_) {}

		// Get polyline count
		let polylineCount = 0;
		try { const ids = await eda.pcb_PrimitivePolyline.getAllPrimitiveId(); polylineCount = ids ? ids.length : 0; } catch (_) {}

		// Get pad count
		let padCount = 0;
		try { const ids = await eda.pcb_PrimitivePad.getAllPrimitiveId(); padCount = ids ? ids.length : 0; } catch (_) {}

		// Get fill count
		let fillCount = 0;
		try { const ids = await eda.pcb_PrimitiveFill.getAllPrimitiveId(); fillCount = ids ? ids.length : 0; } catch (_) {}

		// Get pour (copper zone) count
		let pourCount = 0;
		try { const ids = await eda.pcb_PrimitivePour.getAllPrimitiveId(); pourCount = ids ? ids.length : 0; } catch (_) {}

		// Get region count
		let regionCount = 0;
		try { const ids = await eda.pcb_PrimitiveRegion.getAllPrimitiveId(); regionCount = ids ? ids.length : 0; } catch (_) {}

		// Get dimension count
		let dimensionCount = 0;
		try { const ids = await eda.pcb_PrimitiveDimension.getAllPrimitiveId(); dimensionCount = ids ? ids.length : 0; } catch (_) {}

		// Get string/text count
		let stringCount = 0;
		try { const ids = await eda.pcb_PrimitiveString.getAllPrimitiveId(); stringCount = ids ? ids.length : 0; } catch (_) {}

		let designRuleName = '';
		try { designRuleName = (await eda.pcb_Drc.getCurrentRuleConfigurationName()) || ''; } catch (_) {}

		// DRC: Differential pairs
		let diffPairs: any[] = [];
		try {
			const dp = await eda.pcb_Drc.getAllDifferentialPairs();
			if (Array.isArray(dp)) diffPairs = dp;
			else if (dp && typeof dp === 'object') diffPairs = Object.values(dp);
		}
		catch (_) {}

		// DRC: Equal length net groups
		let equalLengthGroups: any[] = [];
		try { const eg = await eda.pcb_Drc.getAllEqualLengthNetGroups(); if (eg) equalLengthGroups = eg; } catch (_) {}

		// DRC: Net classes
		let netClasses: any[] = [];
		try { const nc = await eda.pcb_Drc.getAllNetClasses(); if (nc) netClasses = nc; } catch (_) {}

		// DRC: Pad pair groups
		let padPairGroups: any[] = [];
		try { const pp = await eda.pcb_Drc.getAllPadPairGroups(); if (pp) padPairGroups = pp; } catch (_) {}

		// Get key net lengths (top 20 longest nets)
		const netLengths: Array<{ name: string; length: number }> = [];
		try {
			for (const net of netNames.slice(0, 50)) {
				if (!net || net === '') continue;
				const len = await eda.pcb_Net.getNetLength(net);
				if (len !== undefined && len > 0) {
					netLengths.push({ name: net, length: len });
				}
			}
			netLengths.sort((a, b) => b.length - a.length);
		}
		catch (_) {}

		// Get component placement data (positions, layers)
		const compPlacements: Array<{ designator: string; name: string; x: number; y: number; layer: string; rotation: number }> = [];
		try {
			const allComps = await eda.pcb_PrimitiveComponent.getAll();
			if (allComps) {
				for (const c of allComps) {
					const des = c.getState_Designator() || '';
					if (!des) continue;
					compPlacements.push({
						designator: des,
						name: c.getState_Name() || '',
						x: c.getState_X(),
						y: c.getState_Y(),
						layer: String(c.getState_Layer()),
						rotation: c.getState_Rotation(),
					});
				}
			}
		}
		catch (_) {}

		// Get board bounding box
		let boardBBox: { minX: number; minY: number; maxX: number; maxY: number } | null = null;
		try {
			const allCompIds = await eda.pcb_PrimitiveComponent.getAllPrimitiveId();
			if (allCompIds && allCompIds.length > 0) {
				const bbox = await eda.pcb_Primitive.getPrimitivesBBox(allCompIds);
				if (bbox) boardBBox = bbox;
			}
		}
		catch (_) {}

		// Collect which layers actually have content (from traces we already fetched)
		const layersWithContent = new Set<string>();
		// tracesPerLayer already has layer IDs with traces
		for (const lk of Object.keys(tracesPerLayer)) { if (tracesPerLayer[lk] > 0) layersWithContent.add(lk); }

		// Also check arcs, polylines, pours, fills on each layer
		try {
			const arcs = await eda.pcb_PrimitiveArc.getAll();
			if (arcs) for (const a of arcs) { const ly = String(a.getState_Layer ? a.getState_Layer() : ''); if (ly) layersWithContent.add(ly); }
		}
		catch (_) {}
		try {
			const polys = await eda.pcb_PrimitivePolyline.getAll();
			if (polys) for (const p of polys) { const ly = String(p.getState_Layer ? p.getState_Layer() : ''); if (ly) layersWithContent.add(ly); }
		}
		catch (_) {}
		try {
			const pours = await eda.pcb_PrimitivePour.getAll();
			if (pours) for (const p of pours) { const ly = String(p.getState_Layer ? p.getState_Layer() : ''); if (ly) layersWithContent.add(ly); }
		}
		catch (_) {}
		try {
			const fills = await eda.pcb_PrimitiveFill.getAll();
			if (fills) for (const f of fills) { const ly = String(f.getState_Layer ? f.getState_Layer() : ''); if (ly) layersWithContent.add(ly); }
		}
		catch (_) {}
		try {
			const regions = await eda.pcb_PrimitiveRegion.getAll();
			if (regions) for (const r of regions) { const ly = String(r.getState_Layer ? r.getState_Layer() : ''); if (ly) layersWithContent.add(ly); }
		}
		catch (_) {}

		// Filter layers: only include layers that actually have primitives on them
		// Always include Top/Bottom copper + their silk/mask/paste, plus any layer with actual content
		const usedLayers = layers.filter(l => {
			const name = l.name.toLowerCase();
			const layerId = String((l as any).id || l.name);
			// Layer has actual primitives
			if (layersWithContent.has(l.name) || layersWithContent.has(layerId)) return true;
			// Always include Top/Bottom layer group (copper, silk, mask, paste)
			if (name === 'toplayer' || name === 'bottomlayer' || name === 'top layer' || name === 'bottom layer') return true;
			if (name.includes('top silk') || name.includes('bottom silk') || name.includes('top solder') || name.includes('bottom solder') || name.includes('top paste') || name.includes('bottom paste')) return true;
			// Exclude everything else (empty inner layers, unused custom layers)
			return false;
		});

		let imageBase64 = '';
		try {
			await eda.pcb_Document.zoomToBoardOutline();
			await delay(500);
			const blob = await eda.dmt_EditorControl.getCurrentRenderedAreaImage();
			if (blob) imageBase64 = await blobToBase64(blob);
		} catch (_) {}

		try {
			await eda.sys_Storage.setExtensionUserConfig('prodoc_pcbreport', JSON.stringify({
				projectName, boardName, layers: usedLayers, componentCount, netNames: netNames.slice(0, 100), drcPassed,
				drcErrors: drcErrors.slice(0, 30),
				pickPlaceCsv, pcbInfoText: (pcbInfoText || '').substring(0, 2000), imageBase64,
				traceCount, tracesPerLayer, viaCount, arcCount, polylineCount, padCount,
				fillCount, pourCount, regionCount, dimensionCount, stringCount,
				netLengths: netLengths.slice(0, 20),
				compPlacements: compPlacements.slice(0, 100),
				boardBBox,
				designRuleName, diffPairs, equalLengthGroups, netClasses, padPairGroups,
				timestamp: Date.now(),
			}));
		}
		catch (storageErr) {
			console.error(PLUGIN_TAG, 'Storage failed:', storageErr);
			try {
				const existing = eda.sys_Storage.getExtensionAllUserConfigs() || {};
				existing['prodoc_pcbreport'] = JSON.stringify({
					projectName, boardName, layers: usedLayers, componentCount, netNames: netNames.slice(0, 50), drcPassed,
					drcErrors: drcErrors.slice(0, 10),
					pickPlaceCsv: '', pcbInfoText: '', imageBase64: '',
					traceCount, tracesPerLayer, viaCount, arcCount, polylineCount, padCount,
					fillCount, pourCount, regionCount, dimensionCount, stringCount,
					netLengths: netLengths.slice(0, 10),
					compPlacements: compPlacements.slice(0, 30),
					boardBBox,
					designRuleName, diffPairs, equalLengthGroups, netClasses, padPairGroups,
					timestamp: Date.now(),
				});
				await eda.sys_Storage.setExtensionAllUserConfigs(existing);
			}
			catch (e2) { eda.sys_Dialog.showInformationMessage('数据存储失败', 'Docs-Generator'); return; }
		}

		await eda.sys_IFrame.openIFrame('/iframe/pcbreport.html', 950, 700, 'prodoc-pcbreport', { title: 'PCB 设计报告', maximizeButton: true, minimizeButton: true });
	}
	catch (err) { console.error(PLUGIN_TAG, 'PCB report failed:', err); eda.sys_Dialog.showInformationMessage('PCB 报告生成失败', 'Docs-Generator'); }
}

/**
 * 打开设置面板
 */
export async function openSettings(): Promise<void> {
	try { await eda.sys_IFrame.openIFrame('/iframe/settings.html', 480, 520, 'prodoc-settings', { title: 'Docs-Generator 设置' }); }
	catch (err) { console.error(PLUGIN_TAG, 'Settings failed:', err); }
}

function resolvePropertyRef(raw: string, props: Record<string, string | number | boolean>): string {
	if (!raw) return '';
	return raw.replace(/=\{([^}]+)\}/g, (_match, key: string) => {
		const val = props[key];
		return val !== undefined && val !== null ? String(val) : '';
	});
}

function blobToBase64(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onloadend = () => resolve(reader.result as string);
		reader.onerror = reject;
		reader.readAsDataURL(blob);
	});
}

function delay(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}
