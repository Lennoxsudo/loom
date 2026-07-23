import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from '../i18n';
import { browserController, BrowserActionEvent } from '../utils/browserController';
import { logDebug } from '../utils/errorHandling';
import {
  BrowserChevronLeftIcon,
  BrowserChevronRightIcon,
  BrowserRefreshIcon,
} from './shared/Icons';
import styles from './BrowserPanel.module.css';

interface BrowserPanelProps {
  initialUrl?: string;
}

type BrowserNotice = 'external' | 'loadFailed' | null;

/**
 * 浏览器预览面板组件
 *
 * 在 IDE 内嵌入一个 iframe 用于预览网页内容。
 * 监听 browserController 的事件来响应 AI 的控制指令。
 */
export default function BrowserPanel({ initialUrl = 'http://localhost:3000' }: BrowserPanelProps) {
  const t = useTranslation();
  const [url, setUrl] = useState(initialUrl);
  const [inputUrl, setInputUrl] = useState(initialUrl);
  const [isLoading, setIsLoading] = useState(false);
  const [notice, setNotice] = useState<BrowserNotice>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const iframeKeyRef = useRef(0);

  const [history, setHistory] = useState<string[]>([initialUrl]);
  const [currentIndex, setCurrentIndex] = useState(0);

  const navigateToUrl = useCallback(
    (newUrl: string, addToHistory = true) => {
      const isExternal = !newUrl.includes('localhost') && !newUrl.includes('127.0.0.1');
      setNotice(isExternal ? 'external' : null);

      setUrl(newUrl);
      setInputUrl(newUrl);
      setIsLoading(true);
      iframeKeyRef.current += 1;

      if (addToHistory) {
        setHistory((prev) => {
          const newHistory = [...prev.slice(0, currentIndex + 1), newUrl];
          setCurrentIndex(newHistory.length - 1);
          return newHistory;
        });
      }
    },
    [currentIndex]
  );

  const goBack = () => {
    if (currentIndex > 0) {
      const newIndex = currentIndex - 1;
      setCurrentIndex(newIndex);
      setUrl(history[newIndex]);
      setInputUrl(history[newIndex]);
      setNotice(null);
      setIsLoading(true);
      iframeKeyRef.current += 1;
    }
  };

  const goForward = () => {
    if (currentIndex < history.length - 1) {
      const newIndex = currentIndex + 1;
      setCurrentIndex(newIndex);
      setUrl(history[newIndex]);
      setInputUrl(history[newIndex]);
      setNotice(null);
      setIsLoading(true);
      iframeKeyRef.current += 1;
    }
  };

  const doRefresh = () => {
    setIsLoading(true);
    setNotice(null);
    iframeKeyRef.current += 1;
  };

  useEffect(() => {
    const handleAction = (e: Event) => {
      const action = (e as BrowserActionEvent).detail;
      logDebug('收到控制指令: ' + JSON.stringify(action), 'BrowserPanel');

      switch (action.type) {
        case 'NAVIGATE':
        case 'OPEN':
          if (action.url) {
            navigateToUrl(action.url, true);
          }
          break;
        case 'REFRESH':
          doRefresh();
          break;
      }
    };

    browserController.addEventListener('browser-action', handleAction);
    return () => {
      browserController.removeEventListener('browser-action', handleAction);
    };
  }, [navigateToUrl]);

  useEffect(() => {
    if (!initialUrl || initialUrl === url) return;
    navigateToUrl(initialUrl, true);
  }, [initialUrl, navigateToUrl, url]);

  const handleNavigate = () => {
    if (inputUrl.trim()) {
      navigateToUrl(inputUrl.trim(), true);
    }
  };

  const handleLoad = () => {
    setIsLoading(false);
  };

  const handleError = () => {
    setIsLoading(false);
    setNotice('loadFailed');
  };

  const canGoBack = currentIndex > 0;
  const canGoForward = currentIndex < history.length - 1;

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <div className={styles.navGroup}>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={goBack}
            disabled={!canGoBack}
            title={t.browser.goBack}
            aria-label={t.browser.goBack}
          >
            <BrowserChevronLeftIcon size={15} />
          </button>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={goForward}
            disabled={!canGoForward}
            title={t.browser.goForward}
            aria-label={t.browser.goForward}
          >
            <BrowserChevronRightIcon size={15} />
          </button>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={doRefresh}
            title={t.browser.refreshPage}
            aria-label={t.browser.refreshPage}
          >
            <BrowserRefreshIcon size={15} />
          </button>
        </div>

        <input
          type="text"
          className={styles.urlInput}
          value={inputUrl}
          onChange={(e) => setInputUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              handleNavigate();
            }
          }}
          placeholder={t.browser.enterUrl}
          spellCheck={false}
        />

        <button type="button" className={styles.goBtn} onClick={handleNavigate}>
          {t.browser.go}
        </button>
      </div>

      {isLoading ? (
        <div className={`${styles.statusBar} ${styles.statusLoading}`}>
          {t.browser.loadingUrl.replace('{url}', url)}
        </div>
      ) : null}

      {notice ? (
        <div
          className={`${styles.statusBar} ${
            notice === 'external' ? styles.statusWarning : styles.statusError
          }`}
        >
          {notice === 'external' ? t.browser.externalSiteWarning : t.browser.loadFailed}
        </div>
      ) : null}

      <div className={styles.frameWrap}>
        <iframe
          key={iframeKeyRef.current}
          ref={iframeRef}
          className={styles.frame}
          src={url}
          onLoad={handleLoad}
          onError={handleError}
          title="Browser Preview"
        />
      </div>
    </div>
  );
}
