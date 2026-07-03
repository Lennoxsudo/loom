import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider } from '../i18n';
import TerminalPanel from './TerminalPanel';

const invokeMock = vi.fn();
const listenHandlers = new Map<string, (event: { payload: unknown }) => void>();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: (eventName: string, handler: (event: { payload: unknown }) => void) => {
    listenHandlers.set(eventName, handler);
    return Promise.resolve(() => {
      listenHandlers.delete(eventName);
    });
  },
}));

type TerminalMock = {
  write: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
  openedIn?: HTMLElement | null;
};

let latestTerminal: TerminalMock | null = null;
let latestFitAddon: { fit: ReturnType<typeof vi.fn> } | null = null;

vi.mock('xterm', () => {
  class Terminal {
    rows = 24;
    cols = 80;
    write = vi.fn();
    clear = vi.fn();
    loadAddon() {}
    openedIn: HTMLElement | null = null;
    open(container: HTMLElement) {
      this.openedIn = container;
    }
    onData() {
      return { dispose: () => {} };
    }
    dispose() {}
    constructor() {
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      latestTerminal = this;
    }
  }
  return { Terminal };
});

vi.mock('xterm-addon-fit', () => ({
  FitAddon: class {
    fit = vi.fn();
    constructor() {
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      latestFitAddon = this;
    }
  },
}));

beforeEach(() => {
  invokeMock.mockReset();
  listenHandlers.clear();
  latestTerminal = null;
  latestFitAddon = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderWithI18n(ui: React.ReactElement) {
  return render(<I18nProvider>{ui}</I18nProvider>);
}

test('TerminalPanel creates initial terminal and renders tab', async () => {
  invokeMock.mockImplementation((command: string) => {
    if (command === 'ensure_terminal') {
      return Promise.resolve({ terminal_id: 'term-1', title: '终端 1', pid: 1001 });
    }
    if (command === 'get_terminal_output') {
      return Promise.resolve({ data: '', next_seq: 0, truncated: false });
    }
    return Promise.resolve(undefined);
  });

  renderWithI18n(
    <TerminalPanel height={240} visible={true} onCloseAll={vi.fn()} onHide={vi.fn()} onHasTerminalsChange={vi.fn()} projectPath="" />
  );

  expect(await screen.findByRole('button', { name: '终端 1' })).toBeInTheDocument();
  await waitFor(() => {
    expect(invokeMock).toHaveBeenCalledWith('ensure_terminal', expect.objectContaining({ workingDir: undefined }));
  });
});

test('TerminalPanel switches tabs and requests output', async () => {
  let createCount = 0;
  invokeMock.mockImplementation((command: string, payload?: Record<string, unknown>) => {
    if (command === 'ensure_terminal') {
      return Promise.resolve({ terminal_id: 'term-1', title: '终端 1' });
    }
    if (command === 'create_terminal') {
      createCount += 1;
      return Promise.resolve({ terminal_id: `term-${createCount + 1}`, title: `终端 ${createCount + 1}` });
    }
    if (command === 'get_terminal_output') {
      return Promise.resolve({ data: 'history', next_seq: 7, truncated: false, ...payload });
    }
    return Promise.resolve(undefined);
  });

  renderWithI18n(
    <TerminalPanel height={240} visible={true} onCloseAll={vi.fn()} onHide={vi.fn()} onHasTerminalsChange={vi.fn()} projectPath="" />
  );

  const addButton = await screen.findByRole('button', { name: '新建终端' });
  await userEvent.click(addButton);
  const firstTab = await screen.findByRole('button', { name: '终端 1' });
  await userEvent.click(firstTab);
  await waitFor(() => {
    expect(invokeMock).toHaveBeenCalledWith('get_terminal_output', expect.objectContaining({ terminalId: 'term-1' }));
  });
});

test('TerminalPanel uses an inner viewport without padding', async () => {
  invokeMock.mockImplementation((command: string) => {
    if (command === 'ensure_terminal') {
      return Promise.resolve({ terminal_id: 'term-1', title: '终端 1' });
    }
    if (command === 'get_terminal_output') {
      return Promise.resolve({ data: '', next_seq: 0, truncated: false });
    }
    return Promise.resolve(undefined);
  });

  renderWithI18n(
    <TerminalPanel height={240} visible={true} onCloseAll={vi.fn()} onHide={vi.fn()} onHasTerminalsChange={vi.fn()} projectPath="" />
  );

  await screen.findByRole('button', { name: '终端 1' });
  const openedIn = latestTerminal?.openedIn as HTMLElement | undefined;
  expect(openedIn).toBeTruthy();
  expect(openedIn?.style.padding).toBe('');
  expect(openedIn?.parentElement).toBeTruthy();
});

test('TerminalPanel shows PID tooltip on tab', async () => {
  invokeMock.mockImplementation((command: string) => {
    if (command === 'ensure_terminal') {
      return Promise.resolve({ terminal_id: 'term-1', title: '终端 1', pid: 4321 });
    }
    if (command === 'get_terminal_output') {
      return Promise.resolve({ data: '', next_seq: 0, truncated: false });
    }
    return Promise.resolve(undefined);
  });

  renderWithI18n(
    <TerminalPanel height={240} visible={true} onCloseAll={vi.fn()} onHide={vi.fn()} onHasTerminalsChange={vi.fn()} projectPath="" />
  );

  const tabButton = await screen.findByRole('button', { name: '终端 1' });
  expect(tabButton).toHaveAttribute('title', 'PID: 4321');
});

test('TerminalPanel adds tab on terminal-created event', async () => {
  invokeMock.mockImplementation((command: string) => {
    if (command === 'ensure_terminal') {
      return Promise.resolve({ terminal_id: 'term-1', title: '终端 1' });
    }
    if (command === 'get_terminal_output') {
      return Promise.resolve({ data: '', next_seq: 0, truncated: false });
    }
    return Promise.resolve(undefined);
  });

  renderWithI18n(
    <TerminalPanel height={240} visible={true} onCloseAll={vi.fn()} onHide={vi.fn()} onHasTerminalsChange={vi.fn()} projectPath="" />
  );

  await screen.findByRole('button', { name: '终端 1' });
  const handler = listenHandlers.get('terminal-created');
  expect(handler).toBeDefined();
  handler?.({ payload: { terminal_id: 'term-2', title: '终端 2', pid: 2222 } });
  expect(await screen.findByRole('button', { name: '终端 2' })).toBeInTheDocument();
});

test('TerminalPanel refits after first terminal output', async () => {
  invokeMock.mockImplementation((command: string) => {
    if (command === 'ensure_terminal') {
      return Promise.resolve({ terminal_id: 'term-1', title: '终端 1' });
    }
    if (command === 'get_terminal_output') {
      return Promise.resolve({ data: '', next_seq: 0, truncated: false });
    }
    return Promise.resolve(undefined);
  });

  renderWithI18n(
    <TerminalPanel height={240} visible={true} onCloseAll={vi.fn()} onHide={vi.fn()} onHasTerminalsChange={vi.fn()} projectPath="" />
  );

  await screen.findByRole('button', { name: '终端 1' });
  const initialCalls = latestFitAddon?.fit.mock.calls.length ?? 0;
  const handler = listenHandlers.get('terminal-data');
  handler?.({ payload: { terminal_id: 'term-1', data: 'line' } });
  await waitFor(() => {
    expect(latestFitAddon?.fit.mock.calls.length ?? 0).toBeGreaterThan(initialCalls);
  });
});

test('TerminalPanel fits before first write', async () => {
  invokeMock.mockImplementation((command: string) => {
    if (command === 'ensure_terminal') {
      return Promise.resolve({ terminal_id: 'term-1', title: '终端 1' });
    }
    if (command === 'get_terminal_output') {
      return Promise.resolve({ data: '', next_seq: 0, truncated: false });
    }
    return Promise.resolve(undefined);
  });

  renderWithI18n(
    <TerminalPanel height={240} visible={true} onCloseAll={vi.fn()} onHide={vi.fn()} onHasTerminalsChange={vi.fn()} projectPath="" />
  );

  await screen.findByRole('button', { name: '终端 1' });
  const fitCallsBefore = latestFitAddon?.fit.mock.calls.length ?? 0;
  const handler = listenHandlers.get('terminal-data');
  handler?.({ payload: { terminal_id: 'term-1', data: 'line' } });
  const fitCallsAfter = latestFitAddon?.fit.mock.calls.length ?? 0;
  expect(fitCallsAfter).toBeGreaterThan(fitCallsBefore);

  const lastFitOrder = latestFitAddon?.fit.mock.invocationCallOrder.slice(-1)[0] ?? 0;
  const lastWriteOrder = latestTerminal?.write.mock.invocationCallOrder.slice(-1)[0] ?? 0;
  expect(lastFitOrder).toBeLessThan(lastWriteOrder);
});

test('TerminalPanel does not write output when hidden', async () => {
  invokeMock.mockImplementation((command: string) => {
    if (command === 'ensure_terminal') {
      return Promise.resolve({ terminal_id: 'term-1', title: '终端 1' });
    }
    if (command === 'get_terminal_output') {
      return Promise.resolve({ data: '', next_seq: 0, truncated: false });
    }
    return Promise.resolve(undefined);
  });

  const { rerender } = renderWithI18n(
    <TerminalPanel height={240} visible={true} onCloseAll={vi.fn()} onHide={vi.fn()} onHasTerminalsChange={vi.fn()} projectPath="" />
  );

  await screen.findByRole('button', { name: '终端 1' });

  rerender(
    <I18nProvider>
      <TerminalPanel height={240} visible={false} onCloseAll={vi.fn()} onHide={vi.fn()} onHasTerminalsChange={vi.fn()} projectPath="" />
    </I18nProvider>
  );

  const handler = listenHandlers.get('terminal-data');
  handler?.({ payload: { terminal_id: 'term-1', data: 'hidden' } });
  expect(latestTerminal?.write).not.toHaveBeenCalledWith('hidden');
});

test('TerminalPanel opens terminal only when visible', async () => {
  invokeMock.mockImplementation((command: string) => {
    if (command === 'ensure_terminal') {
      return Promise.resolve({ terminal_id: 'term-1', title: '终端 1' });
    }
    if (command === 'get_terminal_output') {
      return Promise.resolve({ data: '', next_seq: 0, truncated: false });
    }
    return Promise.resolve(undefined);
  });

  const { rerender } = renderWithI18n(
    <TerminalPanel height={240} visible={false} onCloseAll={vi.fn()} onHide={vi.fn()} onHasTerminalsChange={vi.fn()} projectPath="" />
  );

  expect(latestTerminal?.openedIn ?? null).toBeNull();

  rerender(
    <I18nProvider>
      <TerminalPanel height={240} visible={true} onCloseAll={vi.fn()} onHide={vi.fn()} onHasTerminalsChange={vi.fn()} projectPath="" />
    </I18nProvider>
  );

  await screen.findByRole('button', { name: '终端 1' });
  expect(latestTerminal?.openedIn).toBeTruthy();
});

test('TerminalPanel plus button adds a new tab', async () => {
  let createCount = 0;
  invokeMock.mockImplementation((command: string) => {
    if (command === 'ensure_terminal') {
      return Promise.resolve({ terminal_id: 'term-1', title: '终端 1' });
    }
    if (command === 'create_terminal') {
      createCount += 1;
      return Promise.resolve({ terminal_id: `term-${createCount + 1}`, title: `终端 ${createCount + 1}` });
    }
    if (command === 'get_terminal_output') {
      return Promise.resolve({ data: '', next_seq: 0, truncated: false });
    }
    return Promise.resolve(undefined);
  });

  renderWithI18n(
    <TerminalPanel height={240} visible={true} onCloseAll={vi.fn()} onHide={vi.fn()} onHasTerminalsChange={vi.fn()} projectPath="" />
  );

  const addButton = await screen.findByRole('button', { name: '新建终端' });
  await userEvent.click(addButton);
  expect(await screen.findByRole('button', { name: '终端 2' })).toBeInTheDocument();
});

test('TerminalPanel only writes output for active tab', async () => {
  let createCount = 0;
  invokeMock.mockImplementation((command: string) => {
    if (command === 'ensure_terminal') {
      return Promise.resolve({ terminal_id: 'term-1', title: '终端 1' });
    }
    if (command === 'create_terminal') {
      createCount += 1;
      return Promise.resolve({ terminal_id: `term-${createCount + 1}`, title: `终端 ${createCount + 1}` });
    }
    if (command === 'get_terminal_output') {
      return Promise.resolve({ data: '', next_seq: 0, truncated: false });
    }
    return Promise.resolve(undefined);
  });

  renderWithI18n(
    <TerminalPanel height={240} visible={true} onCloseAll={vi.fn()} onHide={vi.fn()} onHasTerminalsChange={vi.fn()} projectPath="" />
  );

  const addButton = await screen.findByRole('button', { name: '新建终端' });
  await userEvent.click(addButton);
  const firstTab = await screen.findByRole('button', { name: '终端 1' });
  await userEvent.click(firstTab);

  const handler = listenHandlers.get('terminal-data');
  expect(handler).toBeDefined();
  handler?.({ payload: { terminal_id: 'term-2', data: 'skip' } });
  expect(latestTerminal?.write).not.toHaveBeenCalled();
  handler?.({ payload: { terminal_id: 'term-1', data: 'show' } });
  expect(latestTerminal?.write).toHaveBeenCalledWith('show');
});

test('TerminalPanel close button closes last tab and hides panel', async () => {
  invokeMock.mockImplementation((command: string) => {
    if (command === 'ensure_terminal') {
      return Promise.resolve({ terminal_id: 'term-1', title: '终端 1' });
    }
    if (command === 'get_terminal_output') {
      return Promise.resolve({ data: '', next_seq: 0, truncated: false });
    }
    if (command === 'close_terminal') {
      return Promise.resolve(undefined);
    }
    return Promise.resolve(undefined);
  });

  const onCloseAll = vi.fn();
  renderWithI18n(
    <TerminalPanel height={240} visible={true} onCloseAll={onCloseAll} onHide={vi.fn()} onHasTerminalsChange={vi.fn()} projectPath="" />
  );

  const closeButton = await screen.findByRole('button', { name: '关闭终端 1' });
  await userEvent.click(closeButton);
  expect(invokeMock).toHaveBeenCalledWith('close_terminal', { terminalId: 'term-1' });
  expect(onCloseAll).toHaveBeenCalledTimes(1);
});

test('TerminalPanel hide button triggers onHide', async () => {
  invokeMock.mockImplementation((command: string) => {
    if (command === 'ensure_terminal') {
      return Promise.resolve({ terminal_id: 'term-1', title: '终端 1' });
    }
    if (command === 'get_terminal_output') {
      return Promise.resolve({ data: '', next_seq: 0, truncated: false });
    }
    return Promise.resolve(undefined);
  });

  const onHide = vi.fn();
  renderWithI18n(
    <TerminalPanel height={240} visible={true} onCloseAll={vi.fn()} onHide={onHide} onHasTerminalsChange={vi.fn()} projectPath="" />
  );

  const hideButton = await screen.findByRole('button', { name: '隐藏终端' });
  await userEvent.click(hideButton);
  expect(onHide).toHaveBeenCalledTimes(1);
});
