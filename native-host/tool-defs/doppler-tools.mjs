/**
 * Doppler tools are host-side because the local Doppler CLI owns the login
 * token and stores it outside extension storage. Tool results can include
 * secret values, so callers should request named secrets whenever possible.
 */

function okJson(value) {
  return {
    isError: false,
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }]
  }
}

function errText(err) {
  return {
    isError: true,
    content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }]
  }
}

export const DOPPLER_TOOL_DEFS = [
  {
    name: "doppler_status",
    description:
      "Check Doppler CLI/API authentication status without returning the raw token.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "doppler_login",
    description:
      "Start Doppler CLI browser login from the native host. Opens Doppler OAuth in the user's browser.",
    inputSchema: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          description: "Directory scope for the Doppler CLI token. Defaults to /."
        },
        overwrite: {
          type: "boolean",
          description: "Replace an existing CLI token. Defaults to true."
        }
      }
    }
  },
  {
    name: "doppler_secret_get",
    description:
      "Fetch one named Doppler secret value. Uses DOPPLER_TOKEN or the local Doppler CLI login token.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Secret name, e.g. OPENAI_API_KEY." },
        project: { type: "string", description: "Doppler project slug/name. Uses Settings default if omitted." },
        config: { type: "string", description: "Doppler config name. Uses Settings default if omitted." },
        includeDynamicSecrets: { type: "boolean" },
        dynamicSecretsTtlSec: { type: "number" }
      },
      required: ["name"]
    }
  },
  {
    name: "doppler_secrets_download",
    description:
      "Fetch Doppler secrets as JSON. Pass `secrets` to limit output; omitting it returns all accessible secrets.",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string", description: "Doppler project slug/name. Uses Settings default if omitted." },
        config: { type: "string", description: "Doppler config name. Uses Settings default if omitted." },
        secrets: {
          type: "array",
          items: { type: "string" },
          description: "Optional list of secret names to include."
        },
        includeDynamicSecrets: { type: "boolean" },
        dynamicSecretsTtlSec: { type: "number" }
      }
    }
  }
]

export function buildDopplerHostTools(doppler) {
  return [
    {
      ...DOPPLER_TOOL_DEFS[0],
      handler: async () => {
        try {
          return okJson(await doppler.status())
        } catch (err) {
          return errText(err)
        }
      }
    },
    {
      ...DOPPLER_TOOL_DEFS[1],
      handler: async (args) => {
        try {
          const result = await doppler.login(args || {})
          return okJson(result)
        } catch (err) {
          return errText(err)
        }
      }
    },
    {
      ...DOPPLER_TOOL_DEFS[2],
      handler: async (args) => {
        try {
          return okJson(await doppler.getSecret(args || {}))
        } catch (err) {
          return errText(err)
        }
      }
    },
    {
      ...DOPPLER_TOOL_DEFS[3],
      handler: async (args) => {
        try {
          return okJson(await doppler.downloadSecrets(args || {}))
        } catch (err) {
          return errText(err)
        }
      }
    }
  ]
}
