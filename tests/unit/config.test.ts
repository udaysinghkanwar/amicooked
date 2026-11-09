import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { getSchool, paths, reloadConfig, writeConfig } from "../../src/config.js";

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "amicooked-"));
  process.env.AMICOOKED_HOME = home;
  delete process.env.D2L_HOST;
  delete process.env.D2L_LOGIN_URL;
  reloadConfig();
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
  delete process.env.AMICOOKED_HOME;
});

const mcmaster = { id: "mcmaster", name: "McMaster University", lmsName: "Avenue to Learn", host: "avenue.cllmcmaster.ca" };

describe("config", () => {
  it("asks for setup when no school is configured", () => {
    expect(() => getSchool()).toThrow(/amicooked setup/);
  });

  it("round-trips the school through config.json with private permissions", () => {
    writeConfig({ school: mcmaster });
    expect(getSchool().host).toBe("avenue.cllmcmaster.ca");
    expect(fs.statSync(paths().config).mode & 0o777).toBe(0o600);
  });

  it("keeps existing keys when writing a partial update", () => {
    writeConfig({ school: mcmaster });
    writeConfig({ browser: "chrome" });
    const config = reloadConfig();
    expect(config.school?.id).toBe("mcmaster");
    expect(config.browser).toBe("chrome");
  });

  it("lets env vars override the file", () => {
    writeConfig({ school: mcmaster });
    process.env.D2L_HOST = "learn.uwaterloo.ca";
    process.env.D2L_LOGIN_URL = "https://learn.uwaterloo.ca/d2l/login";
    const school = reloadConfig().school!;
    expect(school.host).toBe("learn.uwaterloo.ca");
    expect(school.loginUrl).toBe("https://learn.uwaterloo.ca/d2l/login");
    expect(school.id).toBe("custom");
  });
});
