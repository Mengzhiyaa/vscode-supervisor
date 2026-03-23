/*---------------------------------------------------------------------------------------------
 *  Data Explorer Entry Point
 *  Vite entry point for Data Explorer webview (Svelte 5)
 *--------------------------------------------------------------------------------------------*/

import { mount } from 'svelte';
import DataExplorer from './DataExplorer.svelte';
import './styles.css';

// Mount the Data Explorer component using Svelte 5 API
const app = mount(DataExplorer, {
    target: document.getElementById('app') || document.body
});

export default app;
