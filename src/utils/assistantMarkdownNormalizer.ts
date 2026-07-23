const INLINE_CODE_BLOCK_LANGUAGES = [
  'typescript',
  'javascript',
  'tsx',
  'jsx',
  'ts',
  'js',
  'json',
  'vue',
  'md',
  'markdown',
  'text',
  'plaintext',
  'txt',
  'yaml',
  'yml',
  'bash',
  'shell',
  'sh',
  'python',
  'py',
  'rust',
  'rs',
  'go',
  'toml',
  'ini',
  'xml',
  'docker',
  'dockerfile',
  'java',
  'cpp',
  'c',
  'html',
  'css',
  'sql',
];

const SUPPORTED_FENCE_LANGUAGES = new Set(INLINE_CODE_BLOCK_LANGUAGES);
const SUPPORTED_FENCE_LANGUAGE_PATTERN = INLINE_CODE_BLOCK_LANGUAGES.join('|');

function looksLikeCode(content: string): boolean {
  const trimmed = content.trim();
  if (trimmed.length < 24) {
    return false;
  }

  return /(?:\b(?:export|function|const|let|var|class|return|if|else|import|from|interface|type)\b|[{}();=>]|<\/?[a-z][^>]*>)/.test(
    trimmed
  );
}

function looksLikeNaturalLanguage(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) {
    return false;
  }

  if (/[{};=<>]/.test(trimmed)) {
    return false;
  }

  const lines = trimmed.split('\n');
  const hasTreeLine = lines.some((line) => {
    const t = line.trim();
    if (/[├└│─┌┬┤┴┼]/.test(t)) return true;
    if (/\|[-—~_]{2,}/.test(t) || /^[|\s]*[-—~_]{2,}/.test(t) || /\\[-—~_]{2,}/.test(t))
      return true;
    return false;
  });
  if (hasTreeLine) {
    return false;
  }

  return /[。！？；：]|(?:\b(?:this|that|function|code|implements|returns|uses)\b)|[\u4e00-\u9fff]{2,}/i.test(
    trimmed
  );
}

function normalizeCompactHeadings(content: string): string {
  return content.replace(/(^|\n)(#{1,6})(\d+\.)/g, '$1$2 $3');
}

function isSupportedFenceLanguage(language: string): boolean {
  return SUPPORTED_FENCE_LANGUAGES.has(language.toLowerCase());
}

function isMarkdownBoundary(line: string): boolean {
  return /^(?:#{1,6}\s|---+$|\|.+\||[-*+]\s|\d+\.\s|>{1,3}\s)/.test(line.trim());
}

function isCodeLikeLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) {
    return false;
  }

  return (
    /^(?:\/\/|\/\*|\*\/|<!--|<template\b|<script\b|<style\b|<\/?[a-z]|export\b|import\b|from\b|const\b|let\b|var\b|interface\b|type\b|return\b|if\b|else\b|for\b|while\b|try\b|catch\b|finally\b|\}|\]|\{|\[|"[\w-]+"\s*:|\$ )/i.test(
      trimmed
    ) ||
    /^(?:npm|pnpm|yarn|bun|npx|git|cargo|pip|python|node|deno|go|rustc|javac|java|docker|docker-compose|kubectl|cd|ls|dir|cp|mv|rm|mkdir|touch|cat|echo)\b/i.test(
      trimmed
    ) ||
    /(?:[{}();]|=>|:\s*['"`[{0-9]|,\s*$|^\s{2,}\S|^[A-Za-z_$][\w$]*\s*[=:({[])/.test(trimmed)
  );
}

function isCodeBlockContent(content: string): boolean {
  const meaningfulLines = content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (meaningfulLines.length === 0) {
    return false;
  }

  const codeLikeCount = meaningfulLines.filter(isCodeLikeLine).length;
  return codeLikeCount / meaningfulLines.length >= 0.6;
}

function normalizeAsciiTreeBlock(content: string): string {
  const lines = content.split('\n');
  const hasTreeShape =
    lines.some((line) => /[├└│]─|^\s*[├└│]/.test(line)) ||
    (lines.some((line) => line.trim().endsWith('/')) &&
      lines.some((line) => /^[ \t]*[├└│]/.test(line)));

  if (!hasTreeShape) {
    return content;
  }

  return lines
    .flatMap((line) => {
      const expanded = line
        .replace(/([^\s])#/g, '$1 #')
        .replace(/([^\n])([├└]─\s*)/g, '$1\n$2')
        .replace(/([^\n])([│][ \t]*[├└]─\s*)/g, '$1\n$2');

      return expanded.split('\n');
    })
    .join('\n');
}

function normalizeStandaloneLanguageBlocks(content: string): string {
  const lines = content.split('\n');
  const normalized: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const currentLine = lines[index];
    const language = currentLine.trim().toLowerCase();
    const nextLine = lines[index + 1] ?? '';

    if (isSupportedFenceLanguage(language) && isCodeLikeLine(nextLine)) {
      const block: string[] = [];
      index++;

      while (index < lines.length) {
        const line = lines[index];
        const trimmed = line.trim();
        const followingLine = lines[index + 1] ?? '';

        if (!trimmed) {
          if (isMarkdownBoundary(followingLine)) {
            break;
          }
          block.push('');
          index++;
          continue;
        }

        if (block.length > 0 && isMarkdownBoundary(line)) {
          break;
        }

        if (block.length > 0 && !isCodeLikeLine(line) && !isCodeLikeLine(followingLine)) {
          break;
        }

        block.push(line);
        index++;
      }

      while (block.length > 0 && !block[block.length - 1].trim()) {
        block.pop();
      }

      if (block.length > 0) {
        normalized.push(`\`\`\`${language}`, ...block, '```');
        continue;
      }
    }

    normalized.push(currentLine);
    index++;
  }

  return normalized.join('\n');
}

function isHeadingLine(line: string): boolean {
  return /^(?:#{1,6})(?:\s+\S|\d+\.)/.test(line.trim());
}

function isStandaloneLanguageRestart(line: string, nextLine: string): boolean {
  const language = line.trim().toLowerCase();
  return isSupportedFenceLanguage(language) && isCodeLikeLine(nextLine);
}

function formatFenceBlock(language: string, lines: string[]): string {
  const trimmedLines = [...lines];
  while (trimmedLines.length > 0 && !trimmedLines[0].trim()) {
    trimmedLines.shift();
  }
  while (trimmedLines.length > 0 && !trimmedLines[trimmedLines.length - 1].trim()) {
    trimmedLines.pop();
  }
  if (trimmedLines.length === 0) {
    return '';
  }

  const body = trimmedLines.join('\n');
  return language ? `\`\`\`${language}\n${body}\n\`\`\`` : `\`\`\`\n${body}\n\`\`\``;
}

function splitFenceBodyAtBoundaries(language: string, body: string): string {
  const lines = body.split('\n');
  const parts: string[] = [];
  let currentLanguage = language;
  let currentLines: string[] = [];

  const flushCode = () => {
    const formatted = formatFenceBlock(currentLanguage, currentLines);
    if (formatted) {
      parts.push(formatted);
    }
    currentLines = [];
  };

  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    const nextLine = lines[index + 1] ?? '';

    if (isHeadingLine(line)) {
      flushCode();
      parts.push(normalizeCompactHeadings(line));
      index++;
      continue;
    }

    if (isStandaloneLanguageRestart(line, nextLine)) {
      flushCode();
      currentLanguage = line.trim().toLowerCase();
      index++;
      continue;
    }

    currentLines.push(line);
    index++;
  }

  flushCode();
  return parts.join('\n\n');
}

function processAndSegmentFence(rawLanguage: string, rawBody: string): string {
  let language = rawLanguage.trim().toLowerCase();
  let body = normalizeAsciiTreeBlock(rawBody.replace(/\n$/, ''));

  if (!language) {
    const bodyLines = body.split('\n');
    const candidateLanguage = bodyLines[0]?.trim().toLowerCase() ?? '';
    const remainder = bodyLines.slice(1).join('\n');

    if (isSupportedFenceLanguage(candidateLanguage) && isCodeBlockContent(remainder)) {
      language = candidateLanguage;
      body = remainder;
    }
  } else if (!isSupportedFenceLanguage(language)) {
    language = '';
  }

  if (!body.trim()) {
    return language ? `\`\`\`${language}\n\`\`\`` : '```\n```';
  }

  return splitFenceBodyAtBoundaries(language, body);
}

function resegmentAllFencedCodeBlocks(content: string): string {
  const lines = content.split('\n');
  const result: string[] = [];
  let inFence = false;
  let fenceLang = '';
  let fenceLines: string[] = [];

  const flushFence = () => {
    if (!inFence) {
      return;
    }

    const output = processAndSegmentFence(fenceLang, fenceLines.join('\n'));
    if (output) {
      result.push(...output.split('\n'));
    }

    inFence = false;
    fenceLang = '';
    fenceLines = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (!inFence && trimmed.startsWith('```')) {
      flushFence();
      inFence = true;
      fenceLang = trimmed.slice(3).trim();
      continue;
    }

    if (inFence && trimmed === '```') {
      flushFence();
      continue;
    }

    if (inFence) {
      fenceLines.push(line);
    } else {
      result.push(line);
    }
  }

  flushFence();
  return result.join('\n');
}

function normalizeFencedCodeBlocks(content: string): string {
  return resegmentAllFencedCodeBlocks(content);
}

function wrapAsciiTreesInCodeBlocks(content: string): string {
  if (!content) return content;
  const lines = content.split('\n');
  const result: string[] = [];

  const isTreeLine = (line: string): boolean => {
    const trimmed = line.trim();
    if (!trimmed) return false;

    if (/^\|[\s\-:|]+$/.test(trimmed)) return false;

    if (
      trimmed.startsWith('|') &&
      trimmed.split('|').length >= 3 &&
      !trimmed.includes('——') &&
      !trimmed.includes('──') &&
      !trimmed.includes('--')
    ) {
      return false;
    }

    if (/[├└│─┌┬┤┴┼]/.test(trimmed)) return true;
    if (
      /\|[-—~_]{2,}/.test(trimmed) ||
      /^[|\s]*[-—~_]{2,}/.test(trimmed) ||
      /\\[-—~_]{2,}/.test(trimmed)
    )
      return true;
    return false;
  };

  const isPotentialTreeItem = (line: string): boolean => {
    const trimmed = line.trim();
    if (!trimmed) return false;

    if (
      trimmed.startsWith('|') &&
      trimmed.split('|').length >= 3 &&
      !trimmed.includes('——') &&
      !trimmed.includes('──') &&
      !trimmed.includes('--')
    ) {
      return false;
    }
    if (/^\|[\s\-:|]+$/.test(trimmed)) return false;

    if (isTreeLine(line)) return true;
    if (trimmed.endsWith('/') || trimmed.endsWith(':')) return true;
    if (/\.(?:ts|js|tsx|jsx|vue|json|css|md|py|rs|html|sh|yml|yaml)\b/i.test(trimmed)) return true;
    if (trimmed.includes('/') || trimmed.includes('\\')) return true;
    return false;
  };

  let i = 0;
  let inCodeBlock = false;
  while (i < lines.length) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      result.push(lines[i]);
      i++;
      continue;
    }

    if (inCodeBlock) {
      result.push(lines[i]);
      i++;
      continue;
    }

    if (isPotentialTreeItem(lines[i])) {
      const candidateLines: string[] = [];
      let hasActualTreeSymbol = false;

      while (
        i < lines.length &&
        !lines[i].trim().startsWith('```') &&
        (isPotentialTreeItem(lines[i]) || lines[i].trim() === '')
      ) {
        candidateLines.push(lines[i]);
        if (isTreeLine(lines[i])) {
          hasActualTreeSymbol = true;
        }
        i++;
      }

      while (candidateLines.length > 0 && candidateLines[candidateLines.length - 1].trim() === '') {
        candidateLines.pop();
        i--;
      }

      if (candidateLines.length > 0) {
        if (hasActualTreeSymbol && candidateLines.length >= 2) {
          result.push('```text');
          result.push(...candidateLines);
          result.push('```');
        } else {
          result.push(...candidateLines);
        }
      }
    } else {
      result.push(lines[i]);
      i++;
    }
  }

  return result.join('\n');
}

function isTextFenceLine(line: string): boolean {
  return /^```(?:text|plaintext)?\s*$/i.test(line.trim());
}

/**
 * Apply a transform only to markdown prose segments, leaving fenced code blocks intact.
 * Uses line-based fence tracking to handle unclosed fences during streaming.
 */
function mapOutsideFencedCodeBlocks(
  content: string,
  transform: (prose: string) => string,
  options?: { keepTextFencesInProse?: boolean }
): string {
  if (!content) {
    return content;
  }

  const lines = content.split('\n');
  const result: string[] = [];
  const proseBuffer: string[] = [];
  let inCodeBlock = false;

  const flushProse = () => {
    if (proseBuffer.length === 0) {
      return;
    }
    const prose = proseBuffer.join('\n');
    proseBuffer.length = 0;
    const transformed = transform(prose);
    if (transformed) {
      result.push(...transformed.split('\n'));
    }
  };

  let inTextFence = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (options?.keepTextFencesInProse && isTextFenceLine(line)) {
      inTextFence = true;
      proseBuffer.push(line);
      continue;
    }

    if (options?.keepTextFencesInProse && inTextFence) {
      proseBuffer.push(line);
      if (trimmed === '```') {
        inTextFence = false;
        flushProse();
      }
      continue;
    }

    if (trimmed.startsWith('```')) {
      flushProse();
      inCodeBlock = !inCodeBlock;
      result.push(line);
      continue;
    }

    if (inCodeBlock) {
      result.push(line);
    } else {
      proseBuffer.push(line);
    }
  }

  flushProse();
  return result.join('\n');
}

function applyInlineCodeTransforms(prose: string): string {
  if (!prose.trim()) {
    return prose;
  }

  let normalized = prose;

  normalized = normalized.replace(
    new RegExp(
      '`((?:(?:' +
        SUPPORTED_FENCE_LANGUAGE_PATTERN +
        ')\\s+)?[^`\\n]{24,})`\\s*```(?:text|plaintext)?\\s*\\n([\\s\\S]*?)\\n```',
      'gi'
    ),
    (_match, inlineContent: string, proseContent: string) => {
      const trimmedInline = inlineContent.trim();
      if (!looksLikeCode(trimmedInline) || !looksLikeNaturalLanguage(proseContent)) {
        return _match;
      }

      const languageMatch = new RegExp(
        `^(${SUPPORTED_FENCE_LANGUAGE_PATTERN})\\s+([\\s\\S]+)$`,
        'i'
      ).exec(trimmedInline);
      const language = languageMatch ? languageMatch[1].toLowerCase() : '';
      const code = languageMatch ? languageMatch[2].trim() : trimmedInline;

      return `\n\n\`\`\`${language}\n${code}\n\`\`\`\n\n${proseContent.trim()}\n\n`;
    }
  );

  normalized = normalized.replace(
    new RegExp('`((?:(?:' + SUPPORTED_FENCE_LANGUAGE_PATTERN + ')\\s+)?[^`\\n]{24,})`', 'gi'),
    (_match, inlineContent: string) => {
      const trimmedInline = inlineContent.trim();
      if (!looksLikeCode(trimmedInline)) {
        return `\`${inlineContent}\``;
      }

      const languageMatch = new RegExp(
        `^(${SUPPORTED_FENCE_LANGUAGE_PATTERN})\\s+([\\s\\S]+)$`,
        'i'
      ).exec(trimmedInline);
      const language = languageMatch ? languageMatch[1].toLowerCase() : '';
      const code = languageMatch ? languageMatch[2].trim() : trimmedInline;

      return `\n\n\`\`\`${language}\n${code}\n\`\`\`\n\n`;
    }
  );

  return normalized;
}

function unwrapNaturalLanguageTextFences(content: string): string {
  return content.replace(
    /```(?:text|plaintext)\s*\n([\s\S]*?)\n```/gi,
    (match, blockContent: string) => {
      if (!looksLikeNaturalLanguage(blockContent)) {
        return match;
      }
      return `\n\n${blockContent.trim()}\n\n`;
    }
  );
}

function applyProseStructureTransforms(prose: string): string {
  if (!prose.trim()) {
    return prose;
  }

  let normalized = normalizeCompactHeadings(prose);
  normalized = normalizeStandaloneLanguageBlocks(normalized);
  return normalized;
}

export function normalizeAssistantMarkdown(content: string): string {
  if (!content.trim()) {
    return content;
  }

  let normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  const lines = normalized.split('\n');
  const processedLines: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const isTableSeparator = /^\|[\s\-:|]+$/.test(trimmed) && trimmed.includes('-');

    if (isTableSeparator && i > 0) {
      if (processedLines.length > 1) {
        const lineBeforeHeader = processedLines[processedLines.length - 2];
        if (lineBeforeHeader.trim() !== '') {
          processedLines.splice(processedLines.length - 1, 0, '');
        }
      }
    }
    processedLines.push(line);
  }
  normalized = processedLines.join('\n');

  normalized = wrapAsciiTreesInCodeBlocks(normalized);
  normalized = mapOutsideFencedCodeBlocks(normalized, applyProseStructureTransforms);
  normalized = normalizeFencedCodeBlocks(normalized);
  normalized = mapOutsideFencedCodeBlocks(normalized, applyInlineCodeTransforms, {
    keepTextFencesInProse: true,
  });
  normalized = unwrapNaturalLanguageTextFences(normalized);

  normalized = normalized
    .replace(/([^\n])\n?```/g, '$1\n\n```')
    .replace(/```([a-zA-Z0-9#+_-]+)[ \t]+([^\n])/g, '```$1\n$2')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return normalized;
}
