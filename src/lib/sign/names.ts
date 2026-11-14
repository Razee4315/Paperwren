/** Certificate text is untrusted, including when it is written into a PDF. */
export function cleanName(value: string): string {
	return value.replace(
		// biome-ignore lint/suspicious/noControlCharactersInRegex: remove control and directional formatting characters
		/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,
		"",
	);
}
