import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  actWithRetry,
  dismissStaleModal,
  tryDOMClick,
  tryFillRequiredInputs,
  isSubmitAction,
  isRetryableError,
  delay,
} from '../act-helpers';
import type { Page } from 'playwright';
import type { Stagehand } from '@browserbasehq/stagehand';


function makePage(evaluateResult: unknown = false): Page {
  return {
    evaluate: vi.fn().mockResolvedValue(evaluateResult),
    keyboard: { press: vi.fn().mockResolvedValue(undefined) },
  } as unknown as Page;
}

function makeStagehand(actImpl?: () => Promise<void>): Stagehand {
  return {
    act: vi.fn(actImpl ?? (() => Promise.resolve())),
  } as unknown as Stagehand;
}

// delay

describe('delay', () => {
  it('should resolve after the given milliseconds', async () => {
    const start = Date.now();
    await delay(50);
    expect(Date.now() - start).toBeGreaterThanOrEqual(40);
  });
});

// isRetryableError

describe('isRetryableError', () => {
  it('should match schema errors', () => {
    expect(isRetryableError('schema validation failed')).toBe(true);
    expect(isRetryableError('No object generated from response')).toBe(true);
  });

  it('should match network errors', () => {
    expect(isRetryableError('ECONNRESET')).toBe(true);
    expect(isRetryableError('ETIMEDOUT')).toBe(true);
    expect(isRetryableError('rate limit exceeded')).toBe(true);
    expect(isRetryableError('timeout after 30s')).toBe(true);
  });

  it('should not match normal errors', () => {
    expect(isRetryableError('Element not found')).toBe(false);
    expect(isRetryableError('Act step failed')).toBe(false);
    expect(isRetryableError('No changes detected')).toBe(false);
  });
});

// actWithRetry

describe('actWithRetry', () => {
  it('should succeed on the first attempt without retrying', async () => {
    const stagehand = makeStagehand();
    await actWithRetry(stagehand, 'Click the button');
    expect(stagehand.act).toHaveBeenCalledTimes(1);
    expect(stagehand.act).toHaveBeenCalledWith('Click the button');
  });

  it('should retry on a retryable error and succeed on the second attempt', async () => {
    let calls = 0;
    const stagehand = makeStagehand(() => {
      calls++;
      if (calls === 1) throw new Error('ECONNRESET: connection reset');
      return Promise.resolve();
    });

    await actWithRetry(stagehand, 'Click the button');
    expect(stagehand.act).toHaveBeenCalledTimes(2);
  });

  it('should throw immediately on a non-retryable error', async () => {
    const stagehand = makeStagehand(() => {
      throw new Error('Element not found in accessibility tree');
    });

    await expect(actWithRetry(stagehand, 'Click the button'))
      .rejects.toThrow('Element not found');
    expect(stagehand.act).toHaveBeenCalledTimes(1);
  });

  it('should exhaust all attempts and re-throw on persistent retryable errors', async () => {
    const stagehand = makeStagehand(() => {
      throw new Error('schema validation failed');
    });

    await expect(actWithRetry(stagehand, 'Click the button', 3))
      .rejects.toThrow('schema validation failed');
    expect(stagehand.act).toHaveBeenCalledTimes(3);
  });

  it('should respect custom maxAttempts', async () => {
    const stagehand = makeStagehand(() => {
      throw new Error('ETIMEDOUT');
    });

    await expect(actWithRetry(stagehand, 'Click', 2)).rejects.toThrow();
    expect(stagehand.act).toHaveBeenCalledTimes(2);
  });
});

// dismissStaleModal

describe('dismissStaleModal', () => {
  it('should press Escape and return true when a modal is detected', async () => {
    const page = makePage(true); // evaluate returns true (modal found)
    const result = await dismissStaleModal(page);

    expect(result).toBe(true);
    expect(page.keyboard.press).toHaveBeenCalledWith('Escape');
  });

  it('should return false and not press Escape when no modal is found', async () => {
    const page = makePage(false); // evaluate returns false
    const result = await dismissStaleModal(page);

    expect(result).toBe(false);
    expect(page.keyboard.press).not.toHaveBeenCalled();
  });

  it('should call page.evaluate to check for modal selectors', async () => {
    const page = makePage(false);
    await dismissStaleModal(page);
    expect(page.evaluate).toHaveBeenCalledTimes(1);
  });
});

// tryDOMClick

describe('tryDOMClick', () => {
  it('should return false when instruction has no click-type keyword', async () => {
    const page = makePage(false);
    const result = await tryDOMClick(page, 'Type "hello" into the name field');
    expect(result).toBe(false);
    expect(page.evaluate).not.toHaveBeenCalled();
  });

  it('should return false when no target can be extracted from the instruction', async () => {
    const page = makePage(false);
    const result = await tryDOMClick(page, 'Click the button');
    // No quoted string and no 1-2 digit number
    expect(result).toBe(false);
  });

  it('should return true when DOM click succeeds (quoted target)', async () => {
    const page = makePage(true); // evaluate returns true
    const result = await tryDOMClick(page, 'Click the "Submit" button');
    expect(result).toBe(true);
    expect(page.evaluate).toHaveBeenCalledTimes(1);
  });

  it('should return true when DOM click succeeds (number target)', async () => {
    const page = makePage(true);
    const result = await tryDOMClick(page, 'Rate 9 out of 10');
    expect(result).toBe(true);
  });

  it('should return false when DOM click finds no matching element', async () => {
    const page = makePage(false); // evaluate returns false
    const result = await tryDOMClick(page, 'Click "NonExistentButton"');
    expect(result).toBe(false);
  });

  it('should activate for all click-type keywords', async () => {
    const page = makePage(true);
    for (const instruction of [
      'click "Yes"', 'press "Enter"', 'tap "OK"',
      'select "Option A"', 'choose "Option B"', 'pick "Option C"',
      'rate 5', 'score 3',
    ]) {
      vi.mocked(page.evaluate).mockResolvedValue(true);
      const result = await tryDOMClick(page, instruction);
      expect(result, `Should activate for: "${instruction}"`).toBe(true);
    }
  });
});

// tryFillRequiredInputs

describe('tryFillRequiredInputs', () => {
  it('should return the count of fields filled from page.evaluate', async () => {
    const page = makePage(3); // evaluate returns 3 (fields filled)
    const count = await tryFillRequiredInputs(page);
    expect(count).toBe(3);
    expect(page.evaluate).toHaveBeenCalledTimes(1);
  });

  it('should return 0 when no empty required fields exist', async () => {
    const page = makePage(0); // evaluate returns 0
    const count = await tryFillRequiredInputs(page);
    expect(count).toBe(0);
  });

  it('should call page.evaluate to perform the DOM fill', async () => {
    const page = makePage(1);
    await tryFillRequiredInputs(page);
    expect(page.evaluate).toHaveBeenCalledTimes(1);
  });
});

// isSubmitAction

describe('isSubmitAction', () => {
  it('should match "Click the Submit button" patterns', () => {
    expect(isSubmitAction('Click the "Submit" button')).toBe(true);
    expect(isSubmitAction("Click the 'Submit' button")).toBe(true);
    expect(isSubmitAction('Click the Submit button')).toBe(true);
  });

  it('should match other submit-like button labels', () => {
    expect(isSubmitAction('Click the "Save" button')).toBe(true);
    expect(isSubmitAction('Click the "Create" button')).toBe(true);
    expect(isSubmitAction('Click the "Add" button')).toBe(true);
    expect(isSubmitAction('Click the "Done" button')).toBe(true);
    expect(isSubmitAction('Click the "Confirm" button')).toBe(true);
  });

  it('should match bare "submit" and "save" words', () => {
    expect(isSubmitAction('submit the form')).toBe(true);
    expect(isSubmitAction('save changes')).toBe(true);
  });

  it('should not match non-submit actions', () => {
    expect(isSubmitAction('Click the "Cancel" button')).toBe(false);
    expect(isSubmitAction('Type "hello" into the field')).toBe(false);
    expect(isSubmitAction('Navigate to http://localhost:3000')).toBe(false);
    expect(isSubmitAction('Select "High" from the priority dropdown')).toBe(false);
  });
});
