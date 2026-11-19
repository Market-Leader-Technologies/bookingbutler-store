import type { StoreClient } from "./client";
import { uploadErrorMessage } from "./errors";
import { MAX_UPLOAD_BYTES, type CartUpload } from "./fieldAnswers";

/** Sends one file and gives back what a cart line keeps for its file field. */
export type UploadFile = (
  file: File | Blob,
  options?: { signal?: AbortSignal }
) => Promise<CartUpload>;

/**
 * An uploader for a line's file fields: `POST /uploads`, then the token
 * checkout sends and the name to show. A refusal is thrown as an `Error`
 * whose message is the sentence to show on the field.
 */
export function createUploader(
  client: Pick<StoreClient, "uploadFile">
): UploadFile {
  return async (file, options) => {
    const name = (file as Partial<File>).name ?? "upload";
    if (file.size > MAX_UPLOAD_BYTES) throw new Error(`${name} is over 50 MB.`);
    let data;
    try {
      data = await client.uploadFile(file, options);
    } catch (err) {
      throw new Error(uploadErrorMessage(err), { cause: err });
    }
    if (!data?.uploadToken)
      throw new Error("The file didn't upload. Try again.");
    return {
      uploadToken: data.uploadToken,
      fileName: data.fileName || name,
      ...(data.expiresAt ? { expiresAt: data.expiresAt } : {}),
    };
  };
}
