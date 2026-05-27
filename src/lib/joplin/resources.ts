// src/lib/joplin/resources.ts

import { get, postMultipart } from "./client"
import type { JoplinResource, UploadResourceProps } from "./types"

const DEFAULT_RESOURCE_FIELDS = "id,title,mime,filename,file_extension,size,updated_time"

export async function getResource(
  id: string,
  fields: ReadonlyArray<keyof JoplinResource> | undefined,
  token: string,
  fetchImpl?: typeof fetch
): Promise<JoplinResource> {
  const f = fields ? fields.join(",") : DEFAULT_RESOURCE_FIELDS
  return get<JoplinResource>(`/resources/${encodeURIComponent(id)}`, token, {
    query: { fields: f },
    fetchImpl
  })
}

export async function uploadResource(
  file: Blob,
  props: UploadResourceProps,
  token: string,
  fetchImpl?: typeof fetch
): Promise<string> {
  const propsPayload: Record<string, unknown> = {}
  if (props.title !== undefined) propsPayload.title = props.title
  if (props.filename !== undefined) propsPayload.filename = props.filename
  if (props.mime !== undefined) propsPayload.mime = props.mime
  const res = await postMultipart<{ id?: string }>(
    "/resources",
    token,
    file,
    propsPayload,
    { fetchImpl }
  )
  if (!res.id) throw new Error("Joplin /resources returned no id")
  return res.id
}
