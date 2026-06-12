export interface Board {
    bdid: number;
    boardconfig: string;
    cpid: number;
    platform: string;
}

export interface BaseFirmware {
    identifier: string;
    buildid: string;
    version: string;

    url: string;
    filesize: number;

    releasedate: string;
    uploaddate: string;

    signed: boolean;
}

export interface OTA {
    buildid: string;
    filesize: number;
    identifier: string;
    marketingversion: string;
    prerequisitebuildid: string;
    prerequisiteversion: string;
    releasedate: string;
    releasetype: string;
    signed: boolean;
    uploaddate: string;
    url: string;
    version: string;
}

export interface OTAFirmware extends BaseFirmware {
    prerequisitebuildid: string;
    prerequisiteversion: string;

    releasetype: string;
    marketingversion: string;
}

export interface IPSWFirmware extends BaseFirmware {
    sha1sum: string;
    md5sum: string;
    sha256sum: string;
}

export interface Device {
    bdid: number;
    boardconfig: string;
    boards: Board[];
    cpid: number;
    firmwares: unknown;
    identifier: string;
    name: string;
    platform: string;
}

export interface DeviceWithIPSWs {
    name: string;
    identifier: string;

    boards: Board[];

    boardconfig: string;
    platform: string;
    cpid: number;
    bdid: number;

    firmwares: IPSWFirmware[];
}

export interface DeviceWithOTAs {
    name: string;
    identifier: string;

    boards: Board[];

    boardconfig: string;
    platform: string;
    cpid: number;
    bdid: number;

    firmwares: OTAFirmware[];
}

export interface IdentifiedDevice {
    identifier: string;
}

export interface Release {
    count: number;
    date: string;
    name: string;
    type: string;
}

export interface Releases {
    date: string;
    releases: Release[];
}