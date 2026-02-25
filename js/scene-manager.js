/**
 * Scene manager — tracks which visual effect plays at which frame.
 *
 * A "scene" is a time range [startFrame, endFrame) with an effect name
 * and parameter overrides.  Scenes cannot overlap.  The timeline renders
 * them as colored blocks; the preview pane renders the active effect.
 */

/** Predefined colors for scenes (cycle through). */
const SCENE_COLORS = [
  '#e05577',  // red-pink
  '#55aaee',  // blue
  '#44cc88',  // green
  '#eeaa33',  // orange
  '#aa66dd',  // purple
  '#44cccc',  // cyan
  '#dddd44',  // yellow
  '#dd7744',  // rust
];

let nextId = 1;

export class Scene {
  /**
   * @param {string} effect    Effect name (must match PrototypeRenderer registry)
   * @param {number} start     Start frame (inclusive)
   * @param {number} end       End frame (exclusive)
   * @param {Object} [params]  Parameter overrides for the effect
   */
  constructor(effect, start, end, params = {}) {
    this.id = nextId++;
    this.effect = effect;
    this.start = start;
    this.end = end;
    this.params = params;
    this.color = SCENE_COLORS[(this.id - 1) % SCENE_COLORS.length];
    this.name = '';  // optional display name override
  }

  get duration() { return this.end - this.start; }

  /** Check if this scene contains a given frame. */
  contains(frame) {
    return frame >= this.start && frame < this.end;
  }

  /** Get display label. */
  get label() {
    return this.name || this.effect;
  }
}

export class SceneManager {
  constructor() {
    /** @type {Scene[]} sorted by start frame */
    this.scenes = [];

    /** @type {function|null} called when scenes change */
    this.onChange = null;
  }

  /**
   * Add a new scene.  Trims or removes any overlapping scenes.
   * @returns {Scene} the created scene
   */
  add(effect, start, end, params = {}) {
    const scene = new Scene(effect, start, end, params);
    this._resolveOverlaps(scene);
    this.scenes.push(scene);
    this._sort();
    this._notify();
    return scene;
  }

  /** Remove a scene by id. */
  remove(id) {
    this.scenes = this.scenes.filter(s => s.id !== id);
    this._notify();
  }

  /** Get the scene active at a given frame, or null. */
  getAt(frame) {
    // Binary search would be nice but linear is fine for <100 scenes
    for (const s of this.scenes) {
      if (s.contains(frame)) return s;
      if (s.start > frame) break; // scenes are sorted
    }
    return null;
  }

  /** Get all scenes overlapping a frame range. */
  getInRange(startFrame, endFrame) {
    return this.scenes.filter(s => s.start < endFrame && s.end > startFrame);
  }

  /** Move a scene's start (keeps duration). */
  move(id, newStart) {
    const scene = this.scenes.find(s => s.id === id);
    if (!scene) return;
    const dur = scene.duration;
    scene.start = Math.max(0, newStart);
    scene.end = scene.start + dur;
    this._resolveOverlaps(scene);
    this._sort();
    this._notify();
  }

  /** Resize a scene (change end frame). */
  resize(id, newEnd) {
    const scene = this.scenes.find(s => s.id === id);
    if (!scene) return;
    scene.end = Math.max(scene.start + 1, newEnd);
    this._resolveOverlaps(scene);
    this._sort();
    this._notify();
  }

  /** Update scene parameters. */
  setParams(id, params) {
    const scene = this.scenes.find(s => s.id === id);
    if (!scene) return;
    Object.assign(scene.params, params);
    this._notify();
  }

  /** Change scene effect. */
  setEffect(id, effect) {
    const scene = this.scenes.find(s => s.id === id);
    if (!scene) return;
    scene.effect = effect;
    this._notify();
  }

  /** Get all scenes (sorted). */
  all() {
    return this.scenes;
  }

  /** Clear all scenes. */
  clear() {
    this.scenes = [];
    this._notify();
  }

  /** Export as plain JSON array. */
  toJSON() {
    return this.scenes.map(s => ({
      effect: s.effect,
      start: s.start,
      end: s.end,
      params: s.params,
      name: s.name,
      color: s.color,
    }));
  }

  /** Import from JSON array. */
  fromJSON(data) {
    this.scenes = [];
    for (const d of data) {
      const scene = new Scene(d.effect, d.start, d.end, d.params || {});
      if (d.name) scene.name = d.name;
      if (d.color) scene.color = d.color;
      this.scenes.push(scene);
    }
    this._sort();
    this._notify();
  }

  // -- Internal ---------------------------------------------------------------

  /** Sort scenes by start frame. */
  _sort() {
    this.scenes.sort((a, b) => a.start - b.start);
  }

  /** Trim or remove scenes that overlap with the given scene. */
  _resolveOverlaps(newScene) {
    this.scenes = this.scenes.filter(s => {
      if (s.id === newScene.id) return true; // skip self
      // Completely covered → remove
      if (s.start >= newScene.start && s.end <= newScene.end) return false;
      // Overlap at end → trim
      if (s.start < newScene.start && s.end > newScene.start && s.end <= newScene.end) {
        s.end = newScene.start;
        return true;
      }
      // Overlap at start → trim
      if (s.start >= newScene.start && s.start < newScene.end && s.end > newScene.end) {
        s.start = newScene.end;
        return true;
      }
      // No overlap
      return true;
    });
  }

  _notify() {
    if (this.onChange) this.onChange();
  }
}
