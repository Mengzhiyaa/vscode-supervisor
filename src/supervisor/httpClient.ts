/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as http from 'http';
import * as https from 'https';

type HeaderValue = string | number | boolean;
type HeaderRecord = Record<string, HeaderValue>;

export interface RawAxiosRequestConfig {
	baseURL?: string;
	data?: unknown;
	headers?: HeaderRecord;
	httpAgent?: http.Agent;
	method?: string;
	proxy?: false;
	socketPath?: string;
	timeout?: number;
	url?: string;
}

export interface AxiosResponse<T = unknown> {
	config: RawAxiosRequestConfig;
	data: T;
	headers: http.IncomingHttpHeaders;
	status: number;
	statusText: string;
}

export type AxiosPromise<T = unknown> = Promise<AxiosResponse<T>>;

export class AxiosError<T = unknown> extends Error {
	readonly isAxiosError = true;
	readonly code?: string;
	readonly config: RawAxiosRequestConfig;
	readonly response?: AxiosResponse<T>;
	readonly status?: number;

	constructor(
		message: string,
		config: RawAxiosRequestConfig,
		options?: {
			code?: string;
			cause?: unknown;
			response?: AxiosResponse<T>;
			status?: number;
		}
	) {
		super(message);
		this.name = 'AxiosError';
		this.config = config;
		this.code = options?.code;
		this.response = options?.response;
		this.status = options?.status ?? options?.response?.status;
		if (options?.cause !== undefined) {
			(this as Error & { cause?: unknown }).cause = options.cause;
		}
	}
}

export function isAxiosError(error: unknown): error is AxiosError {
	return typeof error === 'object' &&
		error !== null &&
		(error as { isAxiosError?: unknown }).isAxiosError === true;
}

interface AxiosInterceptorManager<T> {
	use(onFulfilled: (value: T) => T | Promise<T>): number;
}

export interface AxiosInstance {
	create(config?: RawAxiosRequestConfig): AxiosInstance;
	defaults: RawAxiosRequestConfig;
	interceptors: {
		request: AxiosInterceptorManager<RawAxiosRequestConfig>;
	};
	request<T = unknown, R = AxiosResponse<T>>(config: RawAxiosRequestConfig): Promise<R>;
}

interface InternalInterceptorManager<T> extends AxiosInterceptorManager<T> {
	run(value: T): Promise<T>;
}

function createInterceptorManager<T>(): InternalInterceptorManager<T> {
	const handlers: Array<(value: T) => T | Promise<T>> = [];

	return {
		use(onFulfilled: (value: T) => T | Promise<T>): number {
			handlers.push(onFulfilled);
			return handlers.length - 1;
		},
		async run(value: T): Promise<T> {
			let current = value;
			for (const handler of handlers) {
				current = await handler(current);
			}
			return current;
		},
	};
}

function mergeHeaders(
	baseHeaders: HeaderRecord | undefined,
	overrideHeaders: HeaderRecord | undefined
): HeaderRecord | undefined {
	if (!baseHeaders && !overrideHeaders) {
		return undefined;
	}

	return {
		...(baseHeaders ?? {}),
		...(overrideHeaders ?? {}),
	};
}

function mergeConfig(
	baseConfig: RawAxiosRequestConfig,
	overrideConfig: RawAxiosRequestConfig
): RawAxiosRequestConfig {
	return {
		...baseConfig,
		...overrideConfig,
		headers: mergeHeaders(baseConfig.headers, overrideConfig.headers),
	};
}

function normalizeHeaders(headers: HeaderRecord | undefined): http.OutgoingHttpHeaders | undefined {
	if (!headers) {
		return undefined;
	}

	return Object.fromEntries(
		Object.entries(headers).map(([key, value]) => [key, String(value)])
	);
}

function parseBody(data: unknown, headers: HeaderRecord | undefined): Buffer | undefined {
	if (data === undefined || data === null) {
		return undefined;
	}

	if (Buffer.isBuffer(data)) {
		return data;
	}

	if (typeof data === 'string') {
		return Buffer.from(data, 'utf8');
	}

	const contentType = headers?.['Content-Type'] ?? headers?.['content-type'];
	if (typeof contentType === 'string' && contentType.includes('application/json')) {
		return Buffer.from(JSON.stringify(data), 'utf8');
	}

	return Buffer.from(String(data), 'utf8');
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
	if (Array.isArray(value)) {
		return value[0];
	}
	return value;
}

function parseResponseData(body: Buffer, headers: http.IncomingHttpHeaders): unknown {
	if (body.length === 0) {
		return undefined;
	}

	const text = body.toString('utf8');
	const contentType = firstHeaderValue(headers['content-type'])?.toLowerCase() ?? '';

	if (contentType.includes('application/json') || contentType.includes('+json')) {
		try {
			return JSON.parse(text);
		} catch {
			return text;
		}
	}

	return text;
}

interface ParsedRequestTarget {
	client: typeof http | typeof https;
	options: http.RequestOptions;
}

function parseSpecialUrl(url: string): ParsedRequestTarget | undefined {
	const unixMatch = url.match(/^(https?):\/\/unix:([^:]+):(\/.*)?$/);
	if (unixMatch) {
		const protocol = unixMatch[1] === 'https' ? https : http;
		return {
			client: protocol,
			options: {
				socketPath: unixMatch[2],
				path: unixMatch[3] ?? '/',
			},
		};
	}

	const namedPipeMatch = url.match(/^(https?):\/\/npipe:([^:]+):(\/.*)?$/);
	if (namedPipeMatch) {
		const protocol = namedPipeMatch[1] === 'https' ? https : http;
		return {
			client: protocol,
			options: {
				host: 'localhost',
				path: namedPipeMatch[3] ?? '/',
			},
		};
	}

	return undefined;
}

function parseRequestTarget(
	url: string,
	config: RawAxiosRequestConfig
): ParsedRequestTarget {
	const specialTarget = parseSpecialUrl(url);
	if (specialTarget) {
		return specialTarget;
	}

	if (config.socketPath) {
		const parsedUrl = new URL(url);
		return {
			client: parsedUrl.protocol === 'https:' ? https : http,
			options: {
				socketPath: config.socketPath,
				path: `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`,
			},
		};
	}

	const parsedUrl = new URL(url);
	return {
		client: parsedUrl.protocol === 'https:' ? https : http,
		options: {
			host: parsedUrl.hostname,
			port: parsedUrl.port ? Number(parsedUrl.port) : undefined,
			path: `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`,
		},
	};
}

function createRequest(
	config: RawAxiosRequestConfig
): AxiosPromise {
	if (!config.url) {
		return Promise.reject(new AxiosError('Request URL is required', config));
	}

	const { client, options: parsedOptions } = parseRequestTarget(config.url, config);
	const headers = normalizeHeaders(config.headers);
	const body = parseBody(config.data, config.headers);
	if (body && headers && headers['content-length'] === undefined) {
		headers['content-length'] = body.byteLength;
	}

	const requestOptions: http.RequestOptions = {
		...parsedOptions,
		agent: config.httpAgent,
		headers,
		method: config.method?.toUpperCase(),
	};

	return new Promise((resolve, reject) => {
		const request = client.request(requestOptions, (response) => {
			const chunks: Buffer[] = [];

			response.on('data', (chunk: Buffer | string) => {
				chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
			});

			response.on('end', () => {
				const result: AxiosResponse = {
					config,
					data: parseResponseData(Buffer.concat(chunks), response.headers),
					headers: response.headers,
					status: response.statusCode ?? 0,
					statusText: response.statusMessage ?? '',
				};

				if (result.status >= 200 && result.status < 300) {
					resolve(result);
					return;
				}

				reject(new AxiosError(
					`Request failed with status code ${result.status}`,
					config,
					{
						response: result,
						status: result.status,
					}
				));
			});
		});

		request.on('error', (error: NodeJS.ErrnoException) => {
			if (isAxiosError(error)) {
				reject(error);
				return;
			}

			reject(new AxiosError(
				error.message,
				config,
				{
					cause: error,
					code: error.code,
				}
			));
		});

		if (typeof config.timeout === 'number') {
			request.setTimeout(config.timeout, () => {
				request.destroy(new AxiosError(
					`timeout of ${config.timeout}ms exceeded`,
					config,
					{ code: 'ECONNABORTED' }
				));
			});
		}

		if (body) {
			request.write(body);
		}

		request.end();
	});
}

function createInstance(defaultConfig: RawAxiosRequestConfig = {}): AxiosInstance {
	const requestInterceptors = createInterceptorManager<RawAxiosRequestConfig>();

	return {
		defaults: { ...defaultConfig },
		interceptors: {
			request: requestInterceptors,
		},
		create(config: RawAxiosRequestConfig = {}): AxiosInstance {
			return createInstance(mergeConfig(defaultConfig, config));
		},
		async request<T = unknown, R = AxiosResponse<T>>(config: RawAxiosRequestConfig): Promise<R> {
			const mergedConfig = await requestInterceptors.run(mergeConfig(defaultConfig, config));
			return createRequest(mergedConfig) as Promise<R>;
		},
	};
}

const httpClient = createInstance();

export default httpClient;
