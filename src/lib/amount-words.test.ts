import { describe, expect, it } from 'vitest';
import { amountInWords, roundToRupee } from './amount-words';

describe('roundToRupee', () => {
  it.each([
    [118_000, 118_000, 0],
    [118_049, 118_000, -49],
    [118_050, 118_100, 50],
    [118_099, 118_100, 1],
    [49, 0, -49],
  ])('rounds %i paise to %i with a round-off of %i', (total, rounded, roundOff) => {
    expect(roundToRupee(total)).toEqual({ roundedMinor: rounded, roundOffMinor: roundOff });
  });
});

describe('amountInWords', () => {
  it.each([
    [0, 'Indian Rupees Zero Only'],
    [100, 'Indian Rupees One Only'],
    [2_100, 'Indian Rupees Twenty One Only'],
    [10_000, 'Indian Rupees One Hundred Only'],
    [11_800_000, 'Indian Rupees One Lakh Eighteen Thousand Only'],
    [123_456_700, 'Indian Rupees Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven Only'],
    [1_000_000_000, 'Indian Rupees One Crore Only'],
    [12_345_678_900, 'Indian Rupees Twelve Crore Thirty Four Lakh Fifty Six Thousand Seven Hundred Eighty Nine Only'],
    [1_234_567_890_000, 'Indian Rupees One Thousand Two Hundred Thirty Four Crore Fifty Six Lakh Seventy Eight Thousand Nine Hundred Only'],
  ])('writes %i paise in the Indian system', (minor, words) => {
    expect(amountInWords(minor)).toBe(words);
  });

  it('rounds to the rupee first so the words match the amount payable', () => {
    expect(amountInWords(118_050)).toBe('Indian Rupees One Thousand One Hundred Eighty One Only');
    expect(amountInWords(118_049)).toBe('Indian Rupees One Thousand One Hundred Eighty Only');
  });
});
