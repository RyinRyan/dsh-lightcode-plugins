import ts from 'typescript'

export function transpile(code, fileName) {
  const result = ts.transpileModule(code, {
    fileName,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      jsx: fileName.endsWith('.tsx') ? ts.JsxEmit.ReactJSX : ts.JsxEmit.None,
      verbatimModuleSyntax: true,
      isolatedModules: true,
      sourceMap: true,
    },
  })
  return { code: result.outputText, map: result.sourceMapText ?? undefined }
}
