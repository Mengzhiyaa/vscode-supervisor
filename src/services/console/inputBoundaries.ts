/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import type { InputBoundary } from '../../api';

/**
 * A single executable code fragment produced from a `complete` input boundary,
 * carrying its line range within the submitted code so callers can attribute it
 * back to its source lines.
 */
export interface IInputBoundaryFragment {
	/** The fragment code (the boundary's lines joined with `\n`). */
	readonly code: string;

	/** The fragment's 0-based start line within the submitted code. */
	readonly startLine: number;

	/** The fragment's 0-based end line (exclusive) within the submitted code. */
	readonly endLine: number;
}

/**
 * The result of converting input boundaries into executable code fragments.
 */
export interface IInputBoundaryFragments {
	/**
	 * The code fragments for the `complete` boundaries, in order. Each fragment
	 * is the boundary's lines joined with `\n`, tagged with its line range.
	 */
	readonly fragments: IInputBoundaryFragment[];

	/** True if any boundary was `incomplete`. */
	readonly incomplete: boolean;

	/** True if any boundary was `invalid`. */
	readonly invalid: boolean;
}

/**
 * Converts input boundaries into executable code fragments.
 *
 * Boundaries are zero-indexed, end-exclusive line ranges over `code`'s lines.
 * They must be contiguous (each boundary's `start` equal to the previous
 * boundary's `end`), begin at line 0, and end at the last line. `whitespace`
 * boundaries are skipped. A `complete` boundary's fragment is its lines joined
 * with `\n`. `incomplete` and `invalid` boundaries set the corresponding flags
 * but do not contribute fragments (the caller decides what to do with them).
 *
 * @param code The submitted code.
 * @param boundaries The boundaries returned by a provider.
 * @returns The fragments and the incomplete/invalid flags.
 * @throws If the boundaries are malformed (wrong shape, out of range, or
 *   non-contiguous). Callers treat a throw as "no usable provider result".
 */
export function codeFragmentsFromBoundaries(
	code: string,
	boundaries: InputBoundary[]
): IInputBoundaryFragments {
	if (!Array.isArray(boundaries)) {
		throw new Error('Input boundaries must be an array');
	}

	const lines = code.split('\n');
	const fragments: IInputBoundaryFragment[] = [];
	let incomplete = false;
	let invalid = false;
	let nextStart = 0;

	for (const boundary of boundaries) {
		if (!boundary || typeof boundary !== 'object') {
			throw new Error('Input boundary must be an object');
		}

		const kind = boundary.kind;
		if (kind !== 'whitespace' &&
			kind !== 'complete' &&
			kind !== 'incomplete' &&
			kind !== 'invalid'
		) {
			throw new Error(`Unknown input boundary kind: ${kind}`);
		}

		const range = boundary.range;
		if (!range ||
			!Number.isInteger(range.start) ||
			!Number.isInteger(range.end) ||
			range.start !== nextStart ||
			range.start < 0 ||
			range.end < range.start ||
			range.end > lines.length
		) {
			throw new Error('Input boundary range is out of range or non-contiguous');
		}

		// A non-whitespace boundary must span at least one line.
		if (kind !== 'whitespace' && range.start === range.end) {
			throw new Error('Non-whitespace input boundary must span at least one line');
		}

		nextStart = range.end;

		switch (kind) {
			case 'whitespace':
				break;
			case 'complete': {
				const fragment = lines.slice(range.start, range.end).join('\n');
				if (fragment.length > 0) {
					fragments.push({ code: fragment, startLine: range.start, endLine: range.end });
				}
				break;
			}
			case 'incomplete':
				incomplete = true;
				break;
			case 'invalid':
				invalid = true;
				break;
		}
	}

	// The boundaries must cover every line of the code.
	if (nextStart !== lines.length) {
		throw new Error('Input boundaries do not cover the entire code range');
	}

	return { fragments, incomplete, invalid };
}
