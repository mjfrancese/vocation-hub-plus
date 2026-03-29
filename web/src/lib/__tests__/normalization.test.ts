import { describe, it, expect } from 'vitest';
import {
  normalizeChurchName,
  normalizeDiocese,
  normalizePhone,
  normalizeDomain,
} from '../normalization';

describe('normalizeChurchName', () => {
  it('returns empty string for empty input', () => {
    expect(normalizeChurchName('')).toBe('');
  });

  it('handles undefined-like falsy via empty string coercion', () => {
    // The implementation uses (name || '') so null/undefined become ''
    expect(normalizeChurchName(null as unknown as string)).toBe('');
  });

  it('lowercases the name', () => {
    expect(normalizeChurchName('GRACE')).toBe('grace');
  });

  it('replaces Saint with st', () => {
    expect(normalizeChurchName('Saint Andrew')).toBe('st andrew');
  });

  it('replaces Saints with st', () => {
    expect(normalizeChurchName('Saints Peter and Paul')).toBe('st peter paul');
  });

  it('replaces Sts. with st', () => {
    expect(normalizeChurchName('Sts. Peter and Paul')).toBe('st peter paul');
  });

  it('replaces St. with st', () => {
    expect(normalizeChurchName('St. Andrew')).toBe('st andrew');
  });

  it('replaces Mount with mt', () => {
    expect(normalizeChurchName('Mount Calvary')).toBe('mt calvary');
  });

  it('replaces Mt. with mt', () => {
    expect(normalizeChurchName('Mt. Calvary')).toBe('mt calvary');
  });

  it('strips church-related word: episcopal', () => {
    expect(normalizeChurchName('Grace Episcopal')).toBe('grace');
  });

  it('strips church-related word: church', () => {
    expect(normalizeChurchName('Grace Church')).toBe('grace');
  });

  it('strips church-related word: parish', () => {
    expect(normalizeChurchName('Grace Parish')).toBe('grace');
  });

  it('strips church-related word: community', () => {
    expect(normalizeChurchName('Grace Community')).toBe('grace');
  });

  it('strips church-related word: chapel', () => {
    expect(normalizeChurchName('Grace Chapel')).toBe('grace');
  });

  it('strips church-related word: cathedral', () => {
    expect(normalizeChurchName('Grace Cathedral')).toBe('grace');
  });

  it('strips church-related word: mission', () => {
    expect(normalizeChurchName('Grace Mission')).toBe('grace');
  });

  it('strips church-related word: memorial', () => {
    expect(normalizeChurchName('Grace Memorial')).toBe('grace');
  });

  it('strips stop word: the', () => {
    expect(normalizeChurchName('The Church of Grace')).toBe('grace');
  });

  it('strips stop word: of', () => {
    expect(normalizeChurchName('Church of Grace')).toBe('grace');
  });

  it('strips stop word: and', () => {
    expect(normalizeChurchName('Peter and Paul')).toBe('peter paul');
  });

  it('strips stop word: in', () => {
    expect(normalizeChurchName('Grace in the Hills')).toBe('grace hill');
  });

  it('strips stop word: at', () => {
    expect(normalizeChurchName('Chapel at the Lake')).toBe('lake');
  });

  it('strips stop word: for', () => {
    expect(normalizeChurchName('Church for All')).toBe('all');
  });

  it('strips stop word: a', () => {
    expect(normalizeChurchName('a grace')).toBe('grace');
  });

  it('strips stop word: an', () => {
    expect(normalizeChurchName('an community')).toBe('');
  });

  it('strips parenthetical content', () => {
    expect(normalizeChurchName('Grace Church (closed)')).toBe('grace');
  });

  it('strips bilingual suffix after /', () => {
    expect(normalizeChurchName('Grace Church / Iglesia de Gracia')).toBe('grace');
  });

  it('strips comma suffix', () => {
    expect(normalizeChurchName('Grace, The Church')).toBe('grace');
  });

  it('replaces hyphens with spaces', () => {
    expect(normalizeChurchName('St-Andrew')).toBe('st andrew');
  });

  it('strips straight apostrophes', () => {
    expect(normalizeChurchName("St. Paul's Church")).toBe('st paul');
  });

  it('strips curly right apostrophe', () => {
    expect(normalizeChurchName('St. Paul\u2019s Church')).toBe('st paul');
  });

  it('strips curly left apostrophe', () => {
    expect(normalizeChurchName('St. Paul\u2018s Church')).toBe('st paul');
  });

  it('strips backtick', () => {
    expect(normalizeChurchName('St. Paul`s Church')).toBe('st paul');
  });

  it('strips non-alphanumeric punctuation', () => {
    expect(normalizeChurchName('Grace & Glory')).toBe('grace glory');
  });

  it('applies basic plural reduction for 4+ char words ending in s', () => {
    // "hills" -> "hill", "churches" -> "churche" (no, "church" is stripped)
    expect(normalizeChurchName('Grace Hills')).toBe('grace hill');
  });

  it('does not reduce short words (3 chars or fewer)', () => {
    // "sts" -> stripped to "st" by saint rule first; test a short word
    // "gas" has 3 chars, so should not be reduced
    expect(normalizeChurchName('Gas')).toBe('gas');
  });

  it('collapses multiple spaces', () => {
    expect(normalizeChurchName('Grace   Hills')).toBe('grace hill');
  });

  it('trims leading and trailing whitespace', () => {
    expect(normalizeChurchName('  Grace  ')).toBe('grace');
  });

  it('handles a realistic full church name', () => {
    expect(normalizeChurchName("St. Paul's Episcopal Church")).toBe('st paul');
  });

  it('handles another realistic name with bilingual suffix', () => {
    const result = normalizeChurchName('Holy Trinity Church / Santa Trinidad');
    expect(result).toBe('holy trinity');
  });
});

describe('normalizeDiocese', () => {
  it('strips "Diocese of " prefix', () => {
    expect(normalizeDiocese('Diocese of Texas')).toBe('texas');
  });

  it('strips "The " prefix (case insensitive)', () => {
    // "The " is stripped first, leaving "Diocese of Texas", then "Diocese of " is stripped
    expect(normalizeDiocese('The Diocese of Texas')).toBe('texas');
  });

  it('strips "Episcopal Church in " prefix', () => {
    expect(normalizeDiocese('Episcopal Church in the Philippines')).toBe('the philippines');
  });

  it('strips "Episcopal Church " prefix (without "in")', () => {
    expect(normalizeDiocese('Episcopal Church Cuba')).toBe('cuba');
  });

  it('strips "Episcopal Diocese of " prefix', () => {
    expect(normalizeDiocese('Episcopal Diocese of New York')).toBe('new york');
  });

  it('strips "Episcopal Diocese " prefix (without "of")', () => {
    expect(normalizeDiocese('Episcopal Diocese New York')).toBe('new york');
  });

  it('strips "Diocesis de " prefix', () => {
    expect(normalizeDiocese('Diocesis de Honduras')).toBe('honduras');
  });

  it('lowercases the result', () => {
    expect(normalizeDiocese('Diocese of NEW YORK')).toBe('new york');
  });

  it('collapses extra whitespace', () => {
    expect(normalizeDiocese('Diocese of  New  York')).toBe('new york');
  });

  it('preserves plain diocese name with no prefix', () => {
    expect(normalizeDiocese('Texas')).toBe('texas');
  });

  it('handles case-insensitive "THE " prefix', () => {
    expect(normalizeDiocese('THE Diocese of Texas')).toBe('texas');
  });
});

describe('normalizePhone', () => {
  it('returns empty string for empty input', () => {
    expect(normalizePhone('')).toBe('');
  });

  it('returns empty string for falsy input', () => {
    expect(normalizePhone(null as unknown as string)).toBe('');
  });

  it('strips non-digit characters', () => {
    expect(normalizePhone('(555) 867-5309')).toBe('5558675309');
  });

  it('strips leading country code 1 from 11-digit number', () => {
    expect(normalizePhone('15558675309')).toBe('5558675309');
  });

  it('handles 10-digit number as-is', () => {
    expect(normalizePhone('5558675309')).toBe('5558675309');
  });

  it('returns empty string for numbers that are not 10 or 11 digits', () => {
    expect(normalizePhone('555-1234')).toBe('');
  });

  it('returns empty string for 11-digit number not starting with 1', () => {
    expect(normalizePhone('25558675309')).toBe('');
  });

  it('handles formatted number with country code', () => {
    expect(normalizePhone('+1 (555) 867-5309')).toBe('5558675309');
  });
});

describe('normalizeDomain', () => {
  it('extracts hostname from full URL', () => {
    expect(normalizeDomain('https://www.grace.org/about')).toBe('grace.org');
  });

  it('strips www. prefix', () => {
    expect(normalizeDomain('https://www.grace.org')).toBe('grace.org');
  });

  it('handles URL without www', () => {
    expect(normalizeDomain('https://grace.org')).toBe('grace.org');
  });

  it('handles http URL', () => {
    expect(normalizeDomain('http://grace.org')).toBe('grace.org');
  });

  it('handles bare domain by adding https://', () => {
    expect(normalizeDomain('grace.org')).toBe('grace.org');
  });

  it('lowercases the result', () => {
    expect(normalizeDomain('https://GRACE.ORG')).toBe('grace.org');
  });

  it('returns empty string for invalid input', () => {
    expect(normalizeDomain('not a url !!!')).toBe('');
  });

  it('returns empty string for empty string', () => {
    expect(normalizeDomain('')).toBe('');
  });

  it('handles subdomain other than www', () => {
    expect(normalizeDomain('https://news.grace.org')).toBe('news.grace.org');
  });
});
