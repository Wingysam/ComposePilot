import fs from 'fs/promises'
import path from 'path'

import Debug from 'debug'
const debug = Debug('main')
import _ from 'lodash'

import Env from './Env'
import { ShellUtil } from './ShellUtil'

const oldStatePath = path.resolve('state.old')
const newStatePath = path.resolve('state.new')
const finalStatePath = path.resolve('state')

async function generateState() {
  const results = await Promise.allSettled(
    Env.SOURCE_REPOS.map(async (sourceRepo) => {
      const repoId = new Bun.CryptoHasher('sha256')
        .update(sourceRepo)
        .digest('hex')
        .slice(0, 8)

      const repoPath = path.resolve(repoId)

      const shell = new ShellUtil()

      const alreadyCloned = await fs.exists(repoPath)

      if (!alreadyCloned) {
        await shell.$('git', 'clone', sourceRepo, repoPath)
      }
      await shell.cd(repoPath)

      if (alreadyCloned) {
        await shell.$('git', 'fetch')
        await shell.$('git', 'reset', '--hard', 'origin/main')
      }

      try {
        // If there's already a state.old (from a previous failed run or something), delete it
        await fs.rm(oldStatePath, { recursive: true })
      } catch {}

      try {
        // If there's a current state, move it to state.old
        await fs.rename(finalStatePath, oldStatePath)
      } catch {}

      try {
        // If we already have a state.new (from a previous failed run or something), delete it
        await fs.rm(newStatePath, { recursive: true })
      } catch {}

      await fs.mkdir(newStatePath)

      const servicesPath = path.join(repoPath, 'services')

      if (!(await fs.exists(servicesPath))) {
        throw new Error(`No services directory found in ${sourceRepo}`)
      }

      const serviceFiles = (await fs.readdir(servicesPath)).filter((filename) =>
        filename.endsWith('.ts'),
      )

      await Promise.all(
        serviceFiles.map(async (filename) => {
          const serviceId = filename.slice(0, -'.ts'.length)

          const service = await import(path.join(servicesPath, filename))
          const state = await service.default()

          const newServicePath = path.join(
            newStatePath,
            `${serviceId}-${repoId}`,
          )
          await fs.mkdir(newServicePath)

          const dockerComposePath = path.join(
            newServicePath,
            'docker-compose.yml',
          )
          await fs.writeFile(dockerComposePath, JSON.stringify(state))
        }),
      )
    }),
  )

  let allSuccess = true
  for (const result of results) {
    if (result.status === 'rejected') {
      allSuccess = false
      if (result.reason instanceof Error) {
        console.error(result.reason.message)
        debug.enabled && console.error(result.reason)
      } else {
        console.error(result.reason)
      }
    }
  }
  if (!allSuccess) {
    process.exit(1)
  }
}

async function teardownDeletedServices() {
  const oldStateExists = await fs.exists(oldStatePath)
  if (!oldStateExists) {
    return
  }

  const oldServices = await fs.readdir(oldStatePath)

  // ignoring errors here, maybe some services have invalid yaml
  await Promise.allSettled(
    oldServices.map(async (serviceName) => {
      const serviceStillExists = await fs.exists(
        path.join(newStatePath, serviceName),
      )

      if (!serviceStillExists) {
        const oldServicePath = path.join(oldStatePath, serviceName)
        const shell = new ShellUtil()
        await shell.cd(oldServicePath)
        await shell.$('docker', 'compose', 'down')
      }
    }),
  )
}

async function bringUpNewAndChangedServices() {
  const newServices = await fs.readdir(newStatePath)

  const results = await Promise.allSettled(
    newServices.map(async (serviceName) => {
      const servicePath = path.join(newStatePath, serviceName)
      const shell = new ShellUtil()
      await shell.cd(servicePath)
      await shell.$('docker', 'compose', 'pull')
      await shell.$('docker', 'compose', 'up', '-d')
    }),
  )
  for (const result of results) {
    if (result.status === 'rejected') {
      if (result.reason instanceof Error) {
        console.error(`Failed to bring service up: ${result.reason.message}`)
        debug.enabled && console.error(result.reason)
      } else {
        console.error(`Failed to bring service up: ${result.reason}`)
      }
    }
  }
}

async function finalizeState() {
  await fs.rename(newStatePath, finalStatePath)

  try {
    // If we successfully moved the new state to the final state, we no longer need the old state
    await fs.rm(oldStatePath, { recursive: true })
  } catch {}
}

async function main() {
  await generateState()
  await bringUpNewAndChangedServices()
  await teardownDeletedServices()
  await finalizeState()
}

await main()
