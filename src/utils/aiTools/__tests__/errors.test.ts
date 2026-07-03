import { describe, it, expect } from 'vitest';
import { ToolError, ToolErrorCode, ERROR_SUGGESTIONS, isToolError, handleToolError } from '../errors';

describe('ToolError', () => {
  describe('constructor', () => {
    it('should create error with all properties', () => {
      const error = new ToolError(ToolErrorCode.FILE_NOT_FOUND, 'File not found', true);
      
      expect(error.code).toBe(ToolErrorCode.FILE_NOT_FOUND);
      expect(error.message).toBe('File not found');
      expect(error.recoverable).toBe(true);
      expect(error.suggestion).toBe(ERROR_SUGGESTIONS[ToolErrorCode.FILE_NOT_FOUND]);
      expect(error.name).toBe('ToolError');
    });
  });

  describe('static factory methods', () => {
    it('missingParam should create MISSING_PARAM error', () => {
      const error = ToolError.missingParam('path');
      
      expect(error.code).toBe(ToolErrorCode.MISSING_PARAM);
      expect(error.message).toContain('path');
      expect(error.recoverable).toBe(false);
    });

    it('invalidParam should create INVALID_PARAM error', () => {
      const error = ToolError.invalidParam('path', 'must be absolute');
      
      expect(error.code).toBe(ToolErrorCode.INVALID_PARAM);
      expect(error.message).toContain('path');
      expect(error.message).toContain('must be absolute');
      expect(error.recoverable).toBe(true);
    });

    it('fileNotFound should create FILE_NOT_FOUND error', () => {
      const error = ToolError.fileNotFound('/test/file.txt');
      
      expect(error.code).toBe(ToolErrorCode.FILE_NOT_FOUND);
      expect(error.message).toContain('/test/file.txt');
      expect(error.recoverable).toBe(true);
    });

    it('directoryNotFound should create DIRECTORY_NOT_FOUND error', () => {
      const error = ToolError.directoryNotFound();
      
      expect(error.code).toBe(ToolErrorCode.DIRECTORY_NOT_FOUND);
      expect(error.message).toContain('打开一个文件夹');
      expect(error.recoverable).toBe(true);
    });

    it('fileReadError should create FILE_READ_ERROR error', () => {
      const error = ToolError.fileReadError('/test/file.txt', 'permission denied');
      
      expect(error.code).toBe(ToolErrorCode.FILE_READ_ERROR);
      expect(error.message).toContain('/test/file.txt');
      expect(error.message).toContain('permission denied');
    });

    it('terminalError should create TERMINAL_ERROR error', () => {
      const error = ToolError.terminalError('failed to start');
      
      expect(error.code).toBe(ToolErrorCode.TERMINAL_ERROR);
      expect(error.message).toContain('failed to start');
    });

    it('commandError should create COMMAND_ERROR error', () => {
      const error = ToolError.commandError('npm test', 'exit code 1');
      
      expect(error.code).toBe(ToolErrorCode.COMMAND_ERROR);
      expect(error.message).toContain('npm test');
      expect(error.message).toContain('exit code 1');
    });

    it('gitError should create GIT_ERROR error', () => {
      const error = ToolError.gitError('not a git repository');
      
      expect(error.code).toBe(ToolErrorCode.GIT_ERROR);
      expect(error.message).toContain('not a git repository');
    });




    it('unknownError should create UNKNOWN_ERROR error', () => {
      const error = ToolError.unknownError('something went wrong');
      
      expect(error.code).toBe(ToolErrorCode.UNKNOWN_ERROR);
      expect(error.message).toContain('something went wrong');
    });
  });

  describe('toToolResult', () => {
    it('should convert to ToolResult format', () => {
      const error = ToolError.missingParam('path');
      const result = error.toToolResult('test-id');
      
      expect(result.tool_call_id).toBe('test-id');
      expect(result.output).toBe('');
      expect(result.error).toContain('缺少必需参数: path');
      expect(result.error).toContain('建议:');
    });
  });
});

describe('isToolError', () => {
  it('should return true for ToolError instance', () => {
    const error = new ToolError(ToolErrorCode.FILE_NOT_FOUND, 'test', true);
    expect(isToolError(error)).toBe(true);
  });

  it('should return false for regular Error', () => {
    const error = new Error('test');
    expect(isToolError(error)).toBe(false);
  });

  it('should return false for non-error values', () => {
    expect(isToolError('test')).toBe(false);
    expect(isToolError(null)).toBe(false);
    expect(isToolError(undefined)).toBe(false);
  });
});

describe('handleToolError', () => {
  it('should handle ToolError instance', () => {
    const error = ToolError.missingParam('path');
    const result = handleToolError(error, 'test-id');
    
    expect(result.tool_call_id).toBe('test-id');
    expect(result.error).toContain('缺少必需参数');
  });

  it('should handle regular Error', () => {
    const error = new Error('something went wrong');
    const result = handleToolError(error, 'test-id');
    
    expect(result.tool_call_id).toBe('test-id');
    expect(result.error).toContain('something went wrong');
  });

  it('should handle string error', () => {
    const result = handleToolError('string error', 'test-id');
    
    expect(result.tool_call_id).toBe('test-id');
    expect(result.error).toContain('string error');
  });
});

describe('ERROR_SUGGESTIONS', () => {
  it('should have suggestions for all error codes', () => {
    const codes = Object.values(ToolErrorCode);
    
    for (const code of codes) {
      expect(ERROR_SUGGESTIONS[code]).toBeDefined();
      expect(ERROR_SUGGESTIONS[code].length).toBeGreaterThan(0);
    }
  });
});
