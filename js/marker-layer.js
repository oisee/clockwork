/**
 * Marker/event layer system for Clockwork.
 *
 * Layers group markers by type (e.g. "sync", "beats", "sections").
 * Markers are frame-positioned labels with optional numeric values.
 *
 * Supports JSON serialization and Z80 assembly export.
 */

let _nextLayerId = 1;
let _nextMarkerId = 1;

export class MarkerManager {
  constructor() {
    /** @type {Map<number, Layer>} */
    this.layers = new Map();
    this.onChange = null; // callback when data changes
  }

  // --- Layer management ---

  addLayer(name, color = '#ff6699', type = 'sync') {
    const id = _nextLayerId++;
    const layer = { id, name, type, color, visible: true, markers: [] };
    this.layers.set(id, layer);
    this._notify();
    return layer;
  }

  removeLayer(id) {
    this.layers.delete(id);
    this._notify();
  }

  getLayer(id) {
    return this.layers.get(id);
  }

  allLayers() {
    return [...this.layers.values()];
  }

  // --- Marker management ---

  addMarker(layerId, frame, label = '', value = 0) {
    const layer = this.layers.get(layerId);
    if (!layer) return null;

    const id = _nextMarkerId++;
    const marker = { id, frame, label, value };
    layer.markers.push(marker);
    layer.markers.sort((a, b) => a.frame - b.frame);
    this._notify();
    return marker;
  }

  removeMarker(layerId, markerId) {
    const layer = this.layers.get(layerId);
    if (!layer) return;
    layer.markers = layer.markers.filter(m => m.id !== markerId);
    this._notify();
  }

  moveMarker(layerId, markerId, newFrame) {
    const layer = this.layers.get(layerId);
    if (!layer) return;
    const marker = layer.markers.find(m => m.id === markerId);
    if (marker) {
      marker.frame = newFrame;
      layer.markers.sort((a, b) => a.frame - b.frame);
      this._notify();
    }
  }

  updateMarkerLabel(layerId, markerId, label) {
    const layer = this.layers.get(layerId);
    if (!layer) return;
    const marker = layer.markers.find(m => m.id === markerId);
    if (marker) {
      marker.label = label;
      this._notify();
    }
  }

  /** Get all markers across all visible layers in a frame range. */
  getMarkersInRange(startFrame, endFrame) {
    const results = [];
    for (const layer of this.layers.values()) {
      if (!layer.visible) continue;
      for (const marker of layer.markers) {
        if (marker.frame >= startFrame && marker.frame <= endFrame) {
          results.push({ ...marker, layerId: layer.id, color: layer.color });
        }
      }
    }
    return results;
  }

  /** Get marker at exact frame (first match across visible layers). */
  getMarkerAt(frame) {
    for (const layer of this.layers.values()) {
      if (!layer.visible) continue;
      const marker = layer.markers.find(m => m.frame === frame);
      if (marker) return { ...marker, layerId: layer.id, color: layer.color };
    }
    return null;
  }

  // --- Serialization ---

  toJSON() {
    return {
      layers: this.allLayers().map(layer => ({
        id: layer.id,
        name: layer.name,
        type: layer.type,
        color: layer.color,
        visible: layer.visible,
        markers: layer.markers.map(m => ({
          id: m.id,
          frame: m.frame,
          label: m.label,
          value: m.value
        }))
      }))
    };
  }

  fromJSON(json) {
    this.layers.clear();
    if (!json?.layers) return;

    let maxLayerId = 0;
    let maxMarkerId = 0;

    for (const layerData of json.layers) {
      const layer = {
        id: layerData.id,
        name: layerData.name,
        type: layerData.type || 'sync',
        color: layerData.color || '#ff6699',
        visible: layerData.visible !== false,
        markers: (layerData.markers || []).map(m => {
          if (m.id > maxMarkerId) maxMarkerId = m.id;
          return { id: m.id, frame: m.frame, label: m.label || '', value: m.value || 0 };
        })
      };
      if (layer.id > maxLayerId) maxLayerId = layer.id;
      this.layers.set(layer.id, layer);
    }

    _nextLayerId = maxLayerId + 1;
    _nextMarkerId = maxMarkerId + 1;
    this._notify();
  }

  // --- Export ---

  /** Export a single layer as Z80 assembly `dw` table. */
  exportAsm(layerId) {
    const layer = this.layers.get(layerId);
    if (!layer) return '; empty layer\n';

    const lines = [`; ${layer.name} — sync markers`];
    lines.push(`${layer.name.toLowerCase().replace(/\s+/g, '_')}_table:`);

    for (const marker of layer.markers) {
      const comment = marker.label ? ` ; ${marker.label}` : '';
      lines.push(`    dw ${marker.frame}${comment}`);
    }

    lines.push('    dw 65535   ; sentinel');
    return lines.join('\n') + '\n';
  }

  /** Export all layers as JSON string. */
  exportJSON() {
    return JSON.stringify(this.toJSON(), null, 2);
  }

  _notify() {
    if (this.onChange) this.onChange();
  }
}
