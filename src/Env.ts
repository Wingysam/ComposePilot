import { z } from 'zod'
import { fromError } from 'zod-validation-error'

const schema = z.object({
  SOURCE_REPOS: z.string().transform((sourceRepo) => sourceRepo.split(',')),
})

let env: z.infer<typeof schema>

try {
  env = schema.parse(process.env)
} catch (err) {
  console.error(`Failed to load environment variables: ${fromError(err)}`)
  process.exit(1)
}

export default env
