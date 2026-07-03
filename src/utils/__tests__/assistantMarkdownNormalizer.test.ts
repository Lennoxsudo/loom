import { describe, expect, test } from 'vitest';
import { normalizeAssistantMarkdown } from '../assistantMarkdownNormalizer';

describe('normalizeAssistantMarkdown', () => {
  test('keeps template literals inside fenced typescript blocks intact', () => {
    const input = `1. 添加 Meta 标签管理

\`\`\`typescript
// 使用 unhead/vue 或 vueuse/head
import { useHead } from '@unhead/vue'

useHead({
  title: \`\${product.value.name} - 酷态科\`,
  meta: [
    { name: 'description', content: product.value.description },
    { property: 'og:title', content: product.value.name },
    { property: 'og:image', content: product.value.image },
  ]
})
\`\`\`

####2. 添加 Sitemap 和 robots.txt`;

    const result = normalizeAssistantMarkdown(input);

    expect(result).toContain('title: `${product.value.name} - 酷态科`');
    expect((result.match(/```typescript/g) ?? []).length).toBe(1);
    expect((result.match(/^```$/gm) ?? []).length).toBe(1);
    expect(result).toContain('#### 2. 添加 Sitemap 和 robots.txt');
    expect(result).not.toMatch(/\n\n```\n,\n/);
  });

  test('normalizes compact headings without space after hashes', () => {
    const input = '####2. 添加 Sitemap';
    expect(normalizeAssistantMarkdown(input)).toBe('#### 2. 添加 Sitemap');
  });

  test('promotes long inline code-like backticks in prose to fenced blocks', () => {
    const input =
      '已经完成！`typescript export function factorial(n: number): number { if (n < 0) { throw new Error("阶乘不支持负数"); } if (n === 0 || n === 1) { return 1; } return n * factorial(n - 1); }`';

    const result = normalizeAssistantMarkdown(input);

    expect(result).toContain('```typescript');
    expect(result).toContain('export function factorial');
    expect(result).toContain('已经完成！');
  });

  test('unwraps natural-language text fences in prose', () => {
    const input =
      '说明如下：\n```text\n这个函数通过递归实现了阶乘计算，并包含了对负数输入的校验。\n```';

    const result = normalizeAssistantMarkdown(input);

    expect(result).toContain('这个函数通过递归实现了阶乘计算，并包含了对负数输入的校验。');
    expect(result).not.toMatch(/```text/);
  });

  test('promotes inline code followed by text fence when prose looks natural', () => {
    const input =
      '已经完成！在文件末尾新增了一个 `factorial`（阶乘）函数：`typescript export function factorial(n: number): number { if (n < 0) { throw new Error("阶乘不支持负数"); } if (n === 0 || n === 1) { return 1; } return n * factorial(n - 1); }`\n```text\n这个函数通过递归实现了阶乘计算，并包含了对负数输入的校验。\n```';

    const result = normalizeAssistantMarkdown(input);

    expect(result).toContain('export function factorial');
    expect(result).toContain('这个函数通过递归实现了阶乘计算，并包含了对负数输入的校验。');
    expect(result).not.toMatch(/```text/);
  });

  test('splits merged vue fence at headings and standalone language restarts', () => {
    const input = `\`\`\`vue
<!-- 避免直接使用 v-html -->
<div v-html="sanitizeHtml(content)"></div>

####2. 链接安全

vue
<!-- 外部链接添加 rel 属性 -->
<a href="..." target="_blank" rel="noopener noreferrer">

####3. 敏感信息保护

typescript
// 不要将 API key 等敏感信息硬编码
const API_BASE = import.meta.env.VITE_API_BASE
\`\`\``;

    const result = normalizeAssistantMarkdown(input);

    expect((result.match(/```vue/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect((result.match(/```typescript/g) ?? []).length).toBe(1);
    expect(result).toContain('#### 2. 链接安全');
    expect(result).toContain('#### 3. 敏感信息保护');
    expect(result).toContain('sanitizeHtml(content)');
    expect(result).toContain('rel="noopener noreferrer"');
    expect(result).toContain('import.meta.env.VITE_API_BASE');
    expect(result).not.toMatch(/```vue[\s\S]*####2\./);
  });

  test('splits unclosed vue fence at headings and language restarts', () => {
    const input = `\`\`\`vue
<!-- 避免直接使用 v-html -->
<div v-html="sanitizeHtml(content)"></div>

####2. 链接安全

vue
<a href="..." target="_blank" rel="noopener">

####3. 敏感信息保护

typescript
const API_BASE = import.meta.env.VITE_API_BASE`;

    const result = normalizeAssistantMarkdown(input);

    expect((result.match(/```vue/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect((result.match(/```typescript/g) ?? []).length).toBe(1);
    expect(result).toContain('#### 2. 链接安全');
    expect(result).toContain('#### 3. 敏感信息保护');
    expect(result).toContain('import.meta.env.VITE_API_BASE');
  });
});
