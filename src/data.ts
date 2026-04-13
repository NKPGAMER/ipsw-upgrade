interface d {
    localFiles: IPSWFile[]
}

export const data: d = {
    localFiles: []
}

export const state = {
  currentFolder: "",
  currentProduct: "" as Product,
  isDeletingFM: false,
  isUpdateAllFirmware: false,
  autoRemoveOldFiles: false,
  autoRemoveDuplicateFiles: false,

  __init: false
}