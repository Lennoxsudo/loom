/**
 * 国际化入口
 *
 * 提供多语言支持的核心功能
 */

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { zhCN } from './zh-CN';
import { enUS } from './en-US';
import type { I18nMessages, LocaleCode } from './types';

export type { I18nMessages, LocaleCode } from './types';

const messages: Record<LocaleCode, I18nMessages> = {
  'zh-CN': zhCN,
  'en-US': enUS,
};

interface I18nContextValue {
  locale: LocaleCode;
  messages: I18nMessages;
  setLocale: (locale: LocaleCode) => void;
  t: I18nMessages;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({
  children,
  defaultLocale = 'zh-CN',
}: {
  children: ReactNode;
  defaultLocale?: LocaleCode;
}) {
  const [locale, setLocaleState] = useState<LocaleCode>(defaultLocale);

  const setLocale = useCallback((newLocale: LocaleCode) => {
    setLocaleState(newLocale);
  }, []);

  const value: I18nContextValue = {
    locale,
    messages: messages[locale],
    setLocale,
    t: messages[locale],
  };

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used within an I18nProvider');
  }
  return context;
}

export function useTranslation(): I18nMessages {
  const { t } = useI18n();
  return t;
}

export function useLocale(): LocaleCode {
  const { locale } = useI18n();
  return locale;
}

export function getMessages(locale: LocaleCode): I18nMessages {
  return messages[locale] || messages['zh-CN'];
}
