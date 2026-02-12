import { describe, it, expect, vi } from 'vitest';
import { fillEmptyRequiredFields, generateFillValue } from '../form-filler';

describe('fillEmptyRequiredFields', () => {
  it('should fill empty required text and email fields', async () => {
    const fillCalls: Array<{ selector: string; value: string }> = [];
    const locatorFn = vi.fn((sel: string) => ({
      first: () => ({
        fill: vi.fn(async (val: string) => { fillCalls.push({ selector: sel, value: val }); }),
        selectOption: vi.fn(),
      }),
    }));

    const mockPage = {
      evaluate: vi.fn()
        // DOM inspection: two empty required fields
        .mockResolvedValueOnce([
          { id: 'description', name: 'description', tagName: 'textarea', inputType: '', placeholder: 'Description', label: 'Description', selector: '#description' },
          { id: 'customerEmail', name: 'customerEmail', tagName: 'input', inputType: 'email', placeholder: 'Customer Email', label: 'Customer Email', selector: '#customerEmail' },
        ]),
      locator: locatorFn,
    } as any;

    await fillEmptyRequiredFields(mockPage);

    expect(locatorFn).toHaveBeenCalledWith('#description');
    expect(locatorFn).toHaveBeenCalledWith('#customerEmail');
    expect(fillCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ selector: '#description', value: 'Test description content' }),
        expect.objectContaining({ selector: '#customerEmail', value: expect.stringContaining('@example.com') }),
      ])
    );
  });

  it('should do nothing when all required fields already have values', async () => {
    const locatorFn = vi.fn();
    const mockPage = {
      evaluate: vi.fn().mockResolvedValueOnce([]),
      locator: locatorFn,
    } as any;

    await fillEmptyRequiredFields(mockPage);

    expect(locatorFn).not.toHaveBeenCalled();
  });

  it('should select first non-empty option for required <select> elements', async () => {
    const selectOptionFn = vi.fn().mockResolvedValue(undefined);
    const locatorFn = vi.fn(() => ({
      first: () => ({ selectOption: selectOptionFn, fill: vi.fn() }),
    }));

    const mockPage = {
      evaluate: vi.fn()
        // DOM inspection: one empty required select
        .mockResolvedValueOnce([
          { id: 'category', name: 'category', tagName: 'select', inputType: '', placeholder: '', label: 'Category', selector: '#category' },
        ])
        // Second evaluate: first non-empty option value
        .mockResolvedValueOnce('billing'),
      locator: locatorFn,
    } as any;

    await fillEmptyRequiredFields(mockPage);

    expect(locatorFn).toHaveBeenCalledWith('#category');
    expect(selectOptionFn).toHaveBeenCalledWith('billing');
  });

  it('should handle fill errors gracefully without throwing', async () => {
    const locatorFn = vi.fn(() => ({
      first: () => ({
        fill: vi.fn().mockRejectedValue(new Error('Element detached')),
      }),
    }));

    const mockPage = {
      evaluate: vi.fn().mockResolvedValueOnce([
        { id: 'name', name: 'name', tagName: 'input', inputType: 'text', placeholder: '', label: 'Name', selector: '#name' },
      ]),
      locator: locatorFn,
    } as any;

    // Should not throw
    await expect(fillEmptyRequiredFields(mockPage)).resolves.not.toThrow();
  });
});

describe('generateFillValue', () => {
  it('should return email for email input type', () => {
    const val = generateFillValue({ inputType: 'email', name: 'email', label: '', placeholder: '', tagName: 'input' });
    expect(val).toMatch(/^test-\d+@example\.com$/);
  });

  it('should return email when label hints at email', () => {
    const val = generateFillValue({ inputType: 'text', name: 'contact', label: 'Contact Email', placeholder: '', tagName: 'input' });
    expect(val).toMatch(/@example\.com$/);
  });

  it('should return password for password input type', () => {
    expect(generateFillValue({ inputType: 'password', name: 'pw', label: '', placeholder: '', tagName: 'input' })).toBe('TestPass123!');
  });

  it('should return phone for tel input type', () => {
    expect(generateFillValue({ inputType: 'tel', name: 'phone', label: '', placeholder: '', tagName: 'input' })).toBe('+1234567890');
  });

  it('should return URL for url input type', () => {
    expect(generateFillValue({ inputType: 'url', name: 'website', label: '', placeholder: '', tagName: 'input' })).toBe('https://example.com');
  });

  it('should return number for number input type', () => {
    expect(generateFillValue({ inputType: 'number', name: 'qty', label: '', placeholder: '', tagName: 'input' })).toBe('42');
  });

  it('should return description text for textarea', () => {
    expect(generateFillValue({ inputType: '', name: 'desc', label: '', placeholder: '', tagName: 'textarea' })).toBe('Test description content');
  });

  it('should use placeholder as fill value when available', () => {
    expect(generateFillValue({ inputType: 'text', name: 'title', label: '', placeholder: 'Enter title', tagName: 'input' })).toBe('Enter title');
  });

  it('should fall back to generic text when no hints available', () => {
    expect(generateFillValue({ inputType: 'text', name: 'misc', label: '', placeholder: '', tagName: 'input' })).toBe('Test input');
  });
});
