'use strict';
const path = require('node:path');
const ts = require(path.join(__dirname, '../../../backend/node_modules/typescript'));
module.exports = {
  process(source, filename) {
    return { code: ts.transpileModule(source, {
      fileName: filename, compilerOptions: {
        target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.Node10, esModuleInterop: true,
        experimentalDecorators: true, emitDecoratorMetadata: true,
      },
    }).outputText };
  },
};
