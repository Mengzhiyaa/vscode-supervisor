/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

export interface JupyterPositronLocation {
	uri: string;
	range: JupyterPositronRange;
}

export interface JupyterPositronRange {
	start: JupyterPositronPosition;
	end: JupyterPositronPosition;
}

export interface JupyterPositronPosition {
	line: number;
	character: number;
}
