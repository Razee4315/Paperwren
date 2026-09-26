import { describe, expect, it } from "vitest";
import { OpenError, classifyError, failureCopy } from "../errors";

describe("classifyError", () => {
	it.each([
		["Permission Denial: reading com.android.providers", "permission"],
		["java.lang.SecurityException: no grant", "permission"],
		["No such file or directory (os error 2)", "not_found"],
		["FileNotFoundException: /imports/x.pdf", "not_found"],
		["InvalidPDFException: Invalid PDF structure", "corrupt"],
		["something odd", "unreadable"],
	])("%s -> %s", (message, expected) => {
		expect(classifyError(new Error(message))).toBe(expected);
		expect(classifyError(message)).toBe(expected);
	});

	it("keeps an explicit OpenError", () => {
		expect(classifyError(new OpenError("empty"))).toBe("empty");
	});

	it("tolerates non-errors", () => {
		expect(classifyError(undefined)).toBe("unreadable");
		expect(classifyError({ message: "enoent" })).toBe("not_found");
	});
});

describe("failureCopy", () => {
	it("offers locate only where picking again can help", () => {
		expect(failureCopy("not_found", "a.pdf").action).toBe("locate");
		expect(failureCopy("permission", "a.pdf").action).toBe("locate");
		expect(failureCopy("corrupt", "a.pdf").action).toBeNull();
		expect(failureCopy("unsupported", "a.pdf").action).toBeNull();
	});
	it("names the file", () => {
		expect(failureCopy("not_found", "Report.pdf").message).toContain(
			"Report.pdf",
		);
	});
});
