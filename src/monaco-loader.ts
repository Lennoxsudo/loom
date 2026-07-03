/**
 * Monaco Editor Loader Configuration
 *
 * 使用静态 import 直接加载 Monaco Editor，确保所有语言注册和 tokenizer
 * 在组件渲染前完成。
 *
 * WebView2 CSS 修复已移至 vite.config.ts 的 monacoWebView2CSSFix() 插件，
 * 在构建时替换 Monaco 的 _updateCSS 和 _registerRegularEditorContainer 方法，
 * 使用 adoptedStyleSheets + @layer 方案解决 WebView2 不解析 textContent 的问题。
 */

import * as monaco from 'monaco-editor';
import type * as Monaco from 'monaco-editor';
import 'monaco-editor/min/vs/editor/editor.main.css';
import './monaco-languages';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

function configureMonacoWorkers() {
  const monacoEnvironment = {
    getWorker(_: string, label: string) {
      if (label === 'json') {
        return new jsonWorker();
      }
      if (label === 'css' || label === 'scss' || label === 'less') {
        return new cssWorker();
      }
      if (label === 'html' || label === 'handlebars' || label === 'razor') {
        return new htmlWorker();
      }
      if (label === 'typescript' || label === 'javascript') {
        return new tsWorker();
      }
      return new editorWorker();
    },
  };

  Object.assign(
    globalThis as typeof globalThis & { MonacoEnvironment?: typeof monacoEnvironment },
    {
      MonacoEnvironment: monacoEnvironment,
    }
  );
}

configureMonacoWorkers();

Object.assign(globalThis as typeof globalThis & { monaco?: typeof Monaco }, {
  monaco,
});

export function getMonacoInstance(): typeof Monaco {
  return monaco;
}
