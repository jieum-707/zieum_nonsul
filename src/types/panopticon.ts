export interface RemotePeer {
  id: string;
  label: string;
  hasCamera: boolean;
  stream?: MediaStream;
}

export interface CameraDeviceOption {
  deviceId: string;
  label: string;
}
