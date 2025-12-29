import { DriveClient } from "../shared/drive";

interface FolderMeta {
  name: string;
  parents: string[];
}

export interface PathResolver {
  resolveFolderPath: (folderId: string) => Promise<string>;
  resolveFilePath: (folderId: string, fileName: string) => Promise<string>;
}

export function createRelativePathResolver(drive: DriveClient, rootId: string): PathResolver {
  const folderCache = new Map<string, Promise<FolderMeta>>();
  const pathCache = new Map<string, Promise<string>>();

  const getFolderMeta = (id: string): Promise<FolderMeta> => {
    const cached = folderCache.get(id);
    if (cached) return cached;
    const promise = (async () => {
      const file = await drive.getFile(id);
      return {
        name: file.name,
        parents: file.parents ?? [],
      };
    })();
    folderCache.set(id, promise);
    return promise;
  };

  const resolveFolderPath = (folderId: string): Promise<string> => {
    if (!folderId || folderId === rootId) return Promise.resolve("");
    const cached = pathCache.get(folderId);
    if (cached) return cached;
    const promise = (async () => {
      const meta = await getFolderMeta(folderId);
      const parentId = meta.parents[0];
      if (!parentId || parentId === folderId) return meta.name;
      const parentPath = await resolveFolderPath(parentId);
      return parentPath ? `${parentPath}/${meta.name}` : meta.name;
    })();
    pathCache.set(folderId, promise);
    return promise;
  };

  const resolveFilePath = async (folderId: string, fileName: string): Promise<string> => {
    const folderPath = await resolveFolderPath(folderId);
    return folderPath ? `${folderPath}/${fileName}` : fileName;
  };

  return {
    resolveFolderPath,
    resolveFilePath,
  };
}
