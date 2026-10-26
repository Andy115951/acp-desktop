export type CustomAgent = {
  id: string;
  name: string;
  executable: string;
  args: string[];
  env: Record<string, string>;
};

export function parseLaunchFields(argsJson: string, envJson: string): Pick<CustomAgent, "args" | "env"> {
  // Only structured data; never split a command line or interpolate a shell.
  const args: unknown = JSON.parse(argsJson);
  const env: unknown = JSON.parse(envJson);
  if (!Array.isArray(args) || !args.every((arg) => typeof arg === "string") ||
      !env || Array.isArray(env) || typeof env !== "object" || !Object.values(env).every((value) => typeof value === "string")) {
    throw new Error("Invalid launch fields");
  }
  return { args, env: env as Record<string, string> };
}
