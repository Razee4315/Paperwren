import { describe, expect, it } from "vitest";
import {
	OpenError,
	chromeMajor,
	classifyError,
	engineFault,
	explainFailure,
	failureCopy,
} from "../errors";

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

describe("an out-of-date WebView", () => {
	it("reads the Chromium version from the user agent", () => {
		expect(
			chromeMajor(
				"Mozilla/5.0 (Linux; Android 10; CDY-TN00; HMSCore 6.11) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/99.0.4844.88 HuaweiBrowser/14.0 Mobile Safari/537.36",
			),
		).toBe(99);
		expect(
			chromeMajor(
				"Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko)",
			),
		).toBeNull();
	});

	it("blames the phone only when its engine is old", () => {
		const missing = new TypeError("Promise.withResolvers is not a function");
		expect(engineFault(missing, 99)).toBe(true);
		expect(engineFault(missing, 130)).toBe(false);
		expect(engineFault(missing, null)).toBe(false);
		expect(engineFault(new Error("Invalid PDF structure"), 99)).toBe(false);
		expect(engineFault({ message: "Uncaught SyntaxError: x" }, 99)).toBe(true);
	});

	it("keeps the file's own message on an up-to-date engine", () => {
		expect(explainFailure(new Error("bad xref"), "damaged")).toBe("damaged");
	});
});
