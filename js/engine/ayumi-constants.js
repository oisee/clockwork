export const AYUMI_STRUCT_SIZE = 22928;
export const AYUMI_STRUCT_LEFT_OFFSET = 22888;
export const AYUMI_STRUCT_RIGHT_OFFSET = 22896;
export const AYUMI_STRUCT_CHANNEL_OUT_OFFSET = 22904;

export const DEFAULT_SONG_HZ = 50;
export const DEFAULT_SPEED = 3;
export const DEFAULT_CHANNEL_VOLUMES = [15, 15, 15];
export const DEFAULT_AYM_FREQUENCY = 1773400;

const STEREO_SEPARATION = 60 / 200;

export function getPanSettingsForLayout(layout) {
	const sep = STEREO_SEPARATION;
	const center = 0.5;
	let panA = center,
		panB = center,
		panC = center;

	switch (layout) {
		case 'ACB':
			panA = center - sep;
			panB = center + sep;
			panC = center;
			break;
		case 'BAC':
			panA = center;
			panB = center - sep;
			panC = center + sep;
			break;
		case 'CAB':
			panA = center;
			panB = center + sep;
			panC = center - sep;
			break;
		case 'mono':
			break;
		case 'ABC':
		default:
			panA = center - sep;
			panB = center;
			panC = center + sep;
			break;
	}

	return [
		{ channel: 0, pan: panA, isEqp: 1 },
		{ channel: 1, pan: panB, isEqp: 1 },
		{ channel: 2, pan: panC, isEqp: 1 }
	];
}
