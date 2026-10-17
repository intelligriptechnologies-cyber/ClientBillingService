const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

/** Invoices are payable in whole rupees. The round-off is shown, never hidden. */
export function roundToRupee(totalMinor: number): { roundedMinor: number; roundOffMinor: number } {
  const roundedMinor = Math.floor((totalMinor + 50) / 100) * 100;
  return { roundedMinor, roundOffMinor: roundedMinor - totalMinor };
}

function belowHundred(value: number): string {
  return value < 20 ? ONES[value] : `${TENS[Math.floor(value / 10)]}${value % 10 ? ` ${ONES[value % 10]}` : ''}`;
}

function belowThousand(value: number): string {
  const hundreds = Math.floor(value / 100);
  return [hundreds ? `${ONES[hundreds]} Hundred` : '', belowHundred(value % 100)].filter(Boolean).join(' ');
}

function indianWords(value: number): string {
  if (value === 0) return 'Zero';
  const crore = Math.floor(value / 10_000_000);
  const lakh = Math.floor(value / 100_000) % 100;
  const thousand = Math.floor(value / 1000) % 100;
  return [crore ? `${indianWords(crore)} Crore` : '', lakh ? `${belowHundred(lakh)} Lakh` : '', thousand ? `${belowHundred(thousand)} Thousand` : '', belowThousand(value % 1000)].filter(Boolean).join(' ');
}

/** The amount payable in words, using lakh and crore, after rounding to the rupee. */
export function amountInWords(totalMinor: number): string {
  return `Indian Rupees ${indianWords(roundToRupee(totalMinor).roundedMinor / 100)} Only`;
}
