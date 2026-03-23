//@ts-check

'use strict';

const fs = require('fs');
const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');

function resolveDuckdbAsset(name) {
  const resolved = path.resolve(__dirname, 'node_modules/@duckdb/duckdb-wasm/dist', name);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Unable to resolve DuckDB asset: ${name}`);
  }

  return resolved;
}

const duckdbCopyPatterns = [
  {
    from: resolveDuckdbAsset('duckdb-eh.wasm'),
    to: 'duckdb/',
  },
  {
    from: resolveDuckdbAsset('duckdb-mvp.wasm'),
    to: 'duckdb/',
  },
  {
    from: resolveDuckdbAsset('duckdb-node-eh.worker.cjs'),
    to: 'duckdb/',
  },
  {
    from: resolveDuckdbAsset('duckdb-node-mvp.worker.cjs'),
    to: 'duckdb/',
  },
  {
    from: resolveDuckdbAsset('duckdb-node.cjs'),
    to: 'duckdb/',
  },
];

module.exports = {
  target: 'node',
  mode: 'none',
  entry: './src/extension.ts',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'extension.js',
    libraryTarget: 'commonjs2',
    clean: true,
  },
  externals: {
    vscode: 'commonjs vscode',
    bufferutil: 'commonjs bufferutil',
    'utf-8-validate': 'commonjs utf-8-validate',
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'ts-loader',
          },
        ],
      },
    ],
  },
  plugins: [
    new CopyWebpackPlugin({
      patterns: duckdbCopyPatterns,
    }),
  ],
  ignoreWarnings: [
    { module: /vscode-languageserver-types/ },
    { module: /duckdb-wasm/ },
  ],
  devtool: 'source-map',
  infrastructureLogging: {
    level: 'log',
  },
};
