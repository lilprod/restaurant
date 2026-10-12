import { BadRequestException } from "@nestjs/common";
import { ASSET_RULES, sniffImage, validateImage } from "./image-validation";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.alloc(16)]);
const ICO = Buffer.concat([Buffer.from([0, 0, 1, 0, 1, 0]), Buffer.alloc(32)]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

describe("validation des images envoyées", () => {
  it("reconnaît les formats d'après leur contenu", () => {
    expect([PNG, JPEG, WEBP, ICO].map(sniffImage)).toEqual(["png", "jpeg", "webp", "ico"]);
    expect(sniffImage(SVG)).toBeNull();
    expect(sniffImage(Buffer.from("hello"))).toBeNull();
  });
  it("accepte les formats autorisés par type d'image", () => {
    expect(validateImage(PNG, ASSET_RULES.logo)).toBe("png");
    expect(validateImage(ICO, ASSET_RULES.favicon)).toBe("ico");
  });
  it("refuse le SVG (script embarqué), un faux .png et un format non prévu", () => {
    expect(() => validateImage(SVG, ASSET_RULES.logo)).toThrow(BadRequestException);
    expect(() => validateImage(Buffer.from("MZ binaire"), ASSET_RULES.logo)).toThrow(BadRequestException);
    expect(() => validateImage(ICO, ASSET_RULES.logo)).toThrow(BadRequestException);
    expect(() => validateImage(JPEG, ASSET_RULES.favicon)).toThrow(BadRequestException);
  });
  it("refuse un fichier vide ou trop gros", () => {
    expect(() => validateImage(undefined, ASSET_RULES.logo)).toThrow(BadRequestException);
    expect(() => validateImage(Buffer.concat([PNG, Buffer.alloc(600 * 1024)]), ASSET_RULES.favicon)).toThrow(/volumineux/);
  });
});
