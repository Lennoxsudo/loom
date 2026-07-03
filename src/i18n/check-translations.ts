import { zhCN } from './zh-CN';
import { enUS } from './en-US';

function getAllKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  const keys: string[] = [];
  for (const key of Object.keys(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
      keys.push(...getAllKeys(obj[key] as Record<string, unknown>, fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys;
}

function checkTranslations(): void {
  const zhKeys = new Set(getAllKeys(zhCN as unknown as Record<string, unknown>));
  const enKeys = new Set(getAllKeys(enUS as unknown as Record<string, unknown>));

  const missingInZh = [...enKeys].filter((k) => !zhKeys.has(k));
  const missingInEn = [...zhKeys].filter((k) => !enKeys.has(k));

  if (missingInZh.length > 0) {
    console.error('Missing in zh-CN:');
    missingInZh.forEach((k) => console.error(`  - ${k}`));
  }

  if (missingInEn.length > 0) {
    console.error('Missing in en-US:');
    missingInEn.forEach((k) => console.error(`  - ${k}`));
  }

  if (missingInZh.length === 0 && missingInEn.length === 0) {
    console.error('All translations are complete!');
    console.error(`Total keys: ${zhKeys.size}`);
  }

  process.exit(missingInZh.length + missingInEn.length > 0 ? 1 : 0);
}

checkTranslations();
