"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const assert = require("assert");
const definitelytyped_header_parser_1 = require("definitelytyped-header-parser");
const io_1 = require("../util/io");
const util_1 = require("../util/util");
const common_1 = require("./common");
const settings_1 = require("./settings");
const versions_1 = require("./versions");
class AllPackages {
    constructor(data, notNeeded) {
        this.data = data;
        this.notNeeded = notNeeded;
    }
    static read(options) {
        return __awaiter(this, void 0, void 0, function* () {
            const map = yield readData();
            const notNeeded = (yield readNotNeededPackages(options)).map(raw => new NotNeededPackage(raw));
            return new AllPackages(map, notNeeded);
        });
    }
    static readTypings() {
        return __awaiter(this, void 0, void 0, function* () {
            return Array.from(flattenData(yield readData()));
        });
    }
    /** Use for `--single` tasks only. Do *not* call this in a loop! */
    static readSingle(name) {
        return __awaiter(this, void 0, void 0, function* () {
            const data = yield readTypesDataFile();
            const raw = data[name];
            if (!raw) {
                throw new Error(`Can't find package ${name}`);
            }
            const versions = Object.keys(raw);
            if (versions.length > 1) {
                throw new Error(`Package ${name} has multiple versions.`);
            }
            return new TypingsData(raw[versions[0]], /*isLatest*/ true);
        });
    }
    getAnyPackage(id) {
        const pkg = this.tryGetTypingsData(id) || this.notNeeded.find(p => p.name === id.name);
        if (!pkg) {
            throw new Error(`Expected to find a package named ${id.name}`);
        }
        return pkg;
    }
    hasTypingFor(dep) {
        return this.tryGetTypingsData(dep) !== undefined;
    }
    /** Gets the latest version of a package. E.g. getLatest(node v6) = node v7. */
    getLatest(pkg) {
        return pkg.isNotNeeded() ? pkg : this.getLatestVersion(pkg.name);
    }
    /** Use only with `--single` tasks. */
    getSingle(packageName) {
        return this.getLatestVersion(packageName);
    }
    getLatestVersion(packageName) {
        const latest = this.tryGetLatestVersion(packageName);
        if (!latest) {
            throw new Error(`No such package ${packageName}.`);
        }
        return latest;
    }
    tryGetLatestVersion(packageName) {
        const versions = this.data.get(packageName);
        return versions && versions.getLatest();
    }
    getTypingsData(id) {
        const pkg = this.tryGetTypingsData(id);
        if (!pkg) {
            throw new Error(`No typings available for ${id}`);
        }
        return pkg;
    }
    tryGetTypingsData({ name, majorVersion }) {
        const versions = this.data.get(name);
        return versions && versions.tryGet(majorVersion);
    }
    allPackages() {
        return [...this.allTypings(), ...this.allNotNeeded()];
    }
    allTypings() {
        return Array.from(flattenData(this.data));
    }
    allNotNeeded() {
        return this.notNeeded;
    }
    /** Returns all of the dependences *that have typings*, ignoring others. */
    *dependencyTypings(pkg) {
        for (const { name, majorVersion } of pkg.dependencies) {
            const versions = this.data.get(name);
            if (versions) {
                yield versions.get(majorVersion);
            }
        }
    }
    /** Like 'dependencyTypings', but includes test dependencies. */
    *allDependencyTypings(pkg) {
        yield* this.dependencyTypings(pkg);
        for (const name of pkg.testDependencies) {
            const versions = this.data.get(name);
            if (versions) {
                yield versions.getLatest();
            }
        }
    }
}
exports.AllPackages = AllPackages;
exports.typesDataFilename = "definitions.json";
function readData() {
    return __awaiter(this, void 0, void 0, function* () {
        const data = yield readTypesDataFile();
        return util_1.mapValues(new Map(Object.entries(data)), raw => new TypingsVersions(raw));
    });
}
function* flattenData(data) {
    for (const versions of data.values()) {
        yield* versions.getAll();
    }
}
/** Prefer to use `AnyPackage` instead of this. */
class PackageBase {
    static compare(a, b) { return a.name.localeCompare(b.name); }
    /** Short description for debug output. */
    get desc() {
        return this.isLatest ? this.name : `${this.name} v${this.major}`;
    }
    constructor(data) {
        this.name = data.typingsPackageName;
        this.libraryName = data.libraryName;
        this.sourceRepoURL = data.sourceRepoURL;
    }
    isNotNeeded() {
        return this instanceof NotNeededPackage;
    }
    /** '@types/foo' for a package 'foo'. */
    get fullNpmName() {
        return fullNpmName(this.name);
    }
    /** '@types%2ffoo' for a package 'foo'. */
    get fullEscapedNpmName() {
        return `@${settings_1.scopeName}%2f${this.name}`;
    }
    get id() {
        return { name: this.name, majorVersion: this.major };
    }
    get outputDirectory() {
        return util_1.joinPaths(outputDir, this.desc);
    }
}
exports.PackageBase = PackageBase;
function fullNpmName(packageName) {
    return `@${settings_1.scopeName}/${packageName}`;
}
exports.fullNpmName = fullNpmName;
const outputDir = util_1.joinPaths(common_1.home, settings_1.outputPath);
class NotNeededPackage extends PackageBase {
    constructor(raw) {
        super(raw);
        for (const key in raw) {
            if (!["libraryName", "typingsPackageName", "sourceRepoURL", "asOfVersion"].includes(key)) {
                throw new Error(`Unexpected key in not-needed package: ${key}`);
            }
        }
        assert(raw.libraryName && raw.typingsPackageName && raw.sourceRepoURL && raw.asOfVersion);
        this.version = versions_1.Semver.parse(raw.asOfVersion, /*isPrerelease*/ false);
    }
    get major() { return this.version.major; }
    get minor() { return this.version.minor; }
    // A not-needed package has no other versions. (TODO: allow that?)
    get isLatest() { return true; }
    get isPrerelease() { return false; }
    get projectName() { return this.sourceRepoURL; }
    get declaredModules() { return []; }
    get globals() { return this.globals; }
    get typeScriptVersion() { return definitelytyped_header_parser_1.TypeScriptVersion.Lowest; }
    readme(useNewline = true) {
        const { libraryName, sourceRepoURL, name } = this;
        const lines = [
            `This is a stub types definition for ${libraryName} (${sourceRepoURL}).`,
            `${libraryName} provides its own type definitions, so you don't need ${fullNpmName(name)} installed!`
        ];
        return lines.join(useNewline ? "\n" : " ");
    }
}
exports.NotNeededPackage = NotNeededPackage;
class TypingsVersions {
    constructor(data) {
        const versions = Object.keys(data).map(Number);
        this.latest = Math.max(...versions);
        this.map = new Map(versions.map((version) => [version, new TypingsData(data[version], version === this.latest)]));
    }
    getAll() {
        return this.map.values();
    }
    get(majorVersion) {
        return majorVersion === "*" ? this.getLatest() : this.getExact(majorVersion);
    }
    tryGet(majorVersion) {
        return majorVersion === "*" ? this.getLatest() : this.tryGetExact(majorVersion);
    }
    getLatest() {
        return this.getExact(this.latest);
    }
    getExact(majorVersion) {
        const data = this.tryGetExact(majorVersion);
        if (!data) {
            throw new Error(`Could not find version ${majorVersion}`);
        }
        return data;
    }
    tryGetExact(majorVersion) {
        return this.map.get(majorVersion);
    }
}
class TypingsData extends PackageBase {
    constructor(data, isLatest) {
        super(data);
        this.data = data;
        this.isLatest = isLatest;
    }
    get testDependencies() { return this.data.testDependencies; }
    get contributors() { return this.data.contributors; }
    get major() { return this.data.libraryMajorVersion; }
    get minor() { return this.data.libraryMinorVersion; }
    get majorMinor() { return { major: this.major, minor: this.minor }; }
    get typeScriptVersion() { return this.data.typeScriptVersion; }
    get files() { return this.data.files; }
    get testFiles() { return this.data.testFiles; }
    get packageJsonDependencies() { return this.data.packageJsonDependencies; }
    get contentHash() { return this.data.contentHash; }
    get declaredModules() { return this.data.declaredModules; }
    get projectName() { return this.data.projectName; }
    get globals() { return this.data.globals; }
    get pathMappings() {
        return Object.entries(this.data.pathMappings);
    }
    get isPrerelease() {
        return definitelytyped_header_parser_1.TypeScriptVersion.isPrerelease(this.typeScriptVersion);
    }
    get dependencies() {
        return this.deps();
    }
    *deps() {
        const raw = this.data.dependencies;
        for (const name in raw) {
            yield { name, majorVersion: raw[name] };
        }
    }
    /** Path to this package, *relative* to the DefinitelyTyped directory. */
    get subDirectoryPath() {
        return this.isLatest ? this.name : `${this.name}/v${this.data.libraryMajorVersion}`;
    }
    directoryPath(options) {
        return util_1.joinPaths(options.typesPath, this.subDirectoryPath);
    }
    filePath(fileName, options) {
        return util_1.joinPaths(this.directoryPath(options), fileName);
    }
}
exports.TypingsData = TypingsData;
function readTypesDataFile() {
    return common_1.readDataFile("parse-definitions", exports.typesDataFilename);
}
function notNeededPackagesPath(options) {
    return util_1.joinPaths(options.definitelyTypedPath, "notNeededPackages.json");
}
function readNotNeededPackages(options) {
    return __awaiter(this, void 0, void 0, function* () {
        return (yield io_1.readJson(notNeededPackagesPath(options))).packages;
    });
}
/** Path to the *root* for a given package. Path to a particular version may differ. */
function packageRootPath(packageName, options) {
    return util_1.joinPaths(options.typesPath, packageName);
}
exports.packageRootPath = packageRootPath;
//# sourceMappingURL=packages.js.map