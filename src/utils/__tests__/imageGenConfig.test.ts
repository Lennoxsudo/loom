import { describe, expect, it, vi, beforeEach } from 'vitest';
import { DEFAULT_IMAGE_GENERATION_CONFIG } from '../../components/settings/types';

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import {
  buildGenerateImageTool,
  filterImageModels,
  getDefaultImageModel,
  getImageAspectRatioStyle,
  isImageGenConfigured,
  normalizeImageGenerationConfig,
  openGeneratedImageInEditor,
  parseGenerateImageAbsolutePaths,
  parseImageSize,
} from '../imageGenConfig';

describe('imageGenConfig', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });
  it('normalizes partial image generation config', () => {
    const config = normalizeImageGenerationConfig({
      enabled: true,
      endpoint: 'https://api.example.com/v1',
      apiKey: 'sk-test',
      models: ['dall-e-3'],
    });

    expect(config.enabled).toBe(true);
    expect(config.models).toEqual(['dall-e-3']);
  });

  it('detects configured image generation', () => {
    expect(isImageGenConfigured(DEFAULT_IMAGE_GENERATION_CONFIG)).toBe(false);
    expect(
      isImageGenConfigured({
        ...DEFAULT_IMAGE_GENERATION_CONFIG,
        enabled: true,
        apiKey: 'sk-test',
        models: ['dall-e-3'],
      })
    ).toBe(true);
  });

  it('filters image model names from provider list', () => {
    expect(
      filterImageModels(['gpt-4o', 'dall-e-3', 'text-embedding-3-small', 'flux-dev', 'sensenova-u1-fast'])
    ).toEqual(['dall-e-3', 'flux-dev', 'sensenova-u1-fast']);
  });

  it('builds generate_image tool from configured models without hallucinated defaults', () => {
    const config = {
      ...DEFAULT_IMAGE_GENERATION_CONFIG,
      enabled: true,
      endpoint: 'https://token.sensenova.cn/v1',
      apiKey: 'sk-test',
      models: ['sensenova-u1-fast'],
    };

    const tool = buildGenerateImageTool(config);
    expect(tool.parameters.properties.model).toBeUndefined();
    expect(tool.description).toContain('sensenova-u1-fast');
    expect(tool.parameters.properties.size?.enum).toContain('2752x1536');
    expect(tool.parameters.properties.quality).toBeUndefined();
    expect(getDefaultImageModel(config)).toBe('sensenova-u1-fast');
  });

  it('exposes model enum when multiple image models are configured', () => {
    const tool = buildGenerateImageTool({
      ...DEFAULT_IMAGE_GENERATION_CONFIG,
      enabled: true,
      apiKey: 'sk-test',
      models: ['dall-e-3', 'dall-e-2'],
    });

    expect(tool.parameters.properties.model?.enum).toEqual(['dall-e-3', 'dall-e-2']);
  });

  it('parses image size strings into aspect ratio css', () => {
    expect(parseImageSize('2752x1536')).toEqual({ width: 2752, height: 1536 });
    expect(parseImageSize('1024x1024')).toEqual({ width: 1024, height: 1024 });
    expect(parseImageSize('invalid')).toBeNull();
    expect(getImageAspectRatioStyle('2752x1536')).toBe('2752 / 1536');
    expect(getImageAspectRatioStyle(undefined, '1 / 1')).toBe('1 / 1');
  });

  it('extracts absolute image paths from generate_image tool output', () => {
    const text = [
      '已生成图片: public/ai-gen-1.png',
      '- public/ai-gen-1.png (123 bytes)',
      '  absolute: D:\\project\\demo\\public\\ai-gen-1.png',
    ].join('\n');

    expect(parseGenerateImageAbsolutePaths(text)).toEqual(['D:\\project\\demo\\public\\ai-gen-1.png']);
  });

  it('opens existing generated image in editor', async () => {
    invokeMock.mockResolvedValue({ exists: true, file_type: 'file' });

    const onMissing = vi.fn();
    const openFile = vi.fn();

    await openGeneratedImageInEditor('D:/project/demo/public/ai-gen-1.png', {
      onMissing,
      openFile,
    });

    expect(invokeMock).toHaveBeenCalledWith('get_file_info', {
      path: 'D:/project/demo/public/ai-gen-1.png',
    });
    expect(onMissing).not.toHaveBeenCalled();
    expect(openFile).toHaveBeenCalledWith('D:/project/demo/public/ai-gen-1.png');
  });

  it('warns when generated image file is missing', async () => {
    invokeMock.mockResolvedValue({ exists: false, file_type: 'file' });

    const onMissing = vi.fn();
    const openFile = vi.fn();

    await openGeneratedImageInEditor('D:/project/demo/public/missing.png', {
      onMissing,
      openFile,
    });

    expect(onMissing).toHaveBeenCalledTimes(1);
    expect(openFile).not.toHaveBeenCalled();
  });

  it('dispatches open-file-in-editor when openFile callback is omitted', async () => {
    invokeMock.mockResolvedValue({ exists: true, file_type: 'file' });
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    await openGeneratedImageInEditor('D:/project/demo/public/ai-gen-1.png', {
      onMissing: vi.fn(),
    });

    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'open-file-in-editor',
        detail: { filePath: 'D:/project/demo/public/ai-gen-1.png' },
      })
    );

    dispatchSpy.mockRestore();
  });
});
