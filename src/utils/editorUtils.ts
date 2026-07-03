export { isTauriCancellationError } from './errorHandling';

export function getLanguage(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase();

  switch (ext) {
    // Web
    case 'ts':
    case 'tsx':
      return 'typescript';
    case 'js':
    case 'jsx':
      return 'javascript';
    case 'css':
      return 'css';
    case 'scss':
      return 'scss';
    case 'less':
      return 'less';
    case 'html':
      return 'html';
    case 'vue':
      return 'html';
    case 'json':
      return 'json';
    case 'md':
      return 'markdown';

    // Systems
    case 'rs':
      return 'rust';
    case 'go':
      return 'go';
    case 'c':
    case 'h':
      return 'c';
    case 'cpp':
    case 'cc':
    case 'cxx':
    case 'hpp':
    case 'hh':
    case 'hxx':
      return 'cpp';
    case 'cs':
      return 'csharp';
    case 'java':
      return 'java';
    case 'kt':
    case 'kts':
      return 'kotlin';
    case 'swift':
      return 'swift';
    case 'rb':
      return 'ruby';
    case 'py':
      return 'python';
    case 'lua':
      return 'lua';

    // Scripting / Shell
    case 'sh':
    case 'bash':
      return 'shell';
    case 'ps1':
    case 'psm1':
      return 'powershell';
    case 'bat':
    case 'cmd':
      return 'bat';
    case 'sql':
      return 'sql';
    case 'pl':
    case 'pm':
      return 'perl';
    case 'php':
      return 'php';
    case 'r':
      return 'r';

    // Config / Data
    case 'yaml':
    case 'yml':
      return 'yaml';
    case 'toml':
      return 'ini';
    case 'ini':
    case 'cfg':
    case 'conf':
      return 'ini';
    case 'xml':
      return 'xml';
    case 'dockerfile':
      return 'dockerfile';

    // Other
    case 'graphql':
    case 'gql':
      return 'graphql';
    case 'dart':
      return 'dart';
    case 'ex':
    case 'exs':
      return 'elixir';
    case 'scala':
      return 'scala';
    case 'fsharp':
    case 'fs':
    case 'fsi':
    case 'fsx':
      return 'fsharp';
    case 'clj':
    case 'cljs':
      return 'clojure';
    case 'tcl':
      return 'tcl';

    default:
      return 'plaintext';
  }
}
