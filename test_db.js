export function getFlagEmoji(countryCode) {
    if (!countryCode || countryCode.length !== 2) {
        return ''; // Return empty string for invalid codes
    }
    
    // The magic offset: 127397 (Regional Indicator 'A' - ASCII 'A')
    const OFFSET = 127397; 

    // 1. Convert to uppercase
    // 2. Split into individual characters ('D', 'E')
    // 3. Map each character to its Unicode code point (e.g., 'D' -> 68)
    // 4. Add the offset to get the Regional Indicator Symbol code point (e.g., 68 + 127397)
    const codePoints = countryCode
        .toUpperCase()
        .split('')
        .map(char => OFFSET + char.charCodeAt(0));

    // Convert the two code points back into a single string (the flag emoji)
    return String.fromCodePoint(...codePoints);
}

const countryCodes = ['US', 'DE', 'FR', 'JP', 'IN', 'BR', 'ZA', 'CN', 'RU', 'GB'];
for (const code of countryCodes) {
    console.log(`${code}`, getFlagEmoji(code));
}