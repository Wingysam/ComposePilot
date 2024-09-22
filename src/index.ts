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

async function resetState() {
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
}

async function generateState() {
  const results = await Promise.allSettled(
    Env.SOURCE_REPOS.map(async (sourceRepo) => {
      const repoId = new Bun.CryptoHasher('sha256')
        .update(sourceRepo)
        .digest('hex')
        .slice(0, 8)

      const repoContainerPath = path.resolve('sources')
      const repoPath = path.join(repoContainerPath, repoId)

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
        // If there are no dependencies, this will fail, but that's fine
        await shell.$('bun', 'install', '--production')
        debug(`Installed dependencies for ${sourceRepo}`)
      } catch (err) {
        debug(`Failed to install dependencies for ${sourceRepo}: ${err}`)
      }

      const appsPath = path.join(repoPath, 'src', 'apps')

      if (!(await fs.exists(appsPath))) {
        throw new Error(`No src/apps directory found in ${sourceRepo}`)
      }

      const appFiles = (await fs.readdir(appsPath)).filter((filename) =>
        filename.endsWith('.ts'),
      )

      await Promise.all(
        appFiles.map(async (filename) => {
          const appId = filename.slice(0, -'.ts'.length)

          debug(`Processing app ${appId} from ${sourceRepo}`)

          const { state } = await import(path.join(appsPath, filename))

          const newAppPath = path.join(newStatePath, `${appId}-${repoId}`)
          await fs.mkdir(newAppPath)

          const dockerComposePath = path.join(newAppPath, 'docker-compose.yml')
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
}

async function teardownDeletedApps() {
  const oldStateExists = await fs.exists(oldStatePath)
  if (!oldStateExists) {
    return
  }

  const oldApps = await fs.readdir(oldStatePath)

  // ignoring errors here, maybe some apps have invalid yaml
  await Promise.allSettled(
    oldApps.map(async (appName) => {
      const appStillExists = await fs.exists(path.join(newStatePath, appName))

      if (!appStillExists) {
        const oldAppPath = path.join(oldStatePath, appName)
        const shell = new ShellUtil()
        await shell.cd(oldAppPath)
        await shell.$('docker', 'compose', 'down')
        console.log(`Tore down ${appName}`)
      }
    }),
  )
}

async function bringUpNewAndChangedApps() {
  const newApps = await fs.readdir(newStatePath)

  const results = await Promise.allSettled(
    newApps.map(async (appName) => {
      const appPath = path.join(newStatePath, appName)
      const shell = new ShellUtil()
      await shell.cd(appPath)
      await shell.$('docker', 'compose', 'pull')
      await shell.$('docker', 'compose', 'up', '-d')
      console.log(`Brought up ${appName}`)
    }),
  )
  for (const result of results) {
    if (result.status === 'rejected') {
      if (result.reason instanceof Error) {
        console.error(`Failed to bring app up: ${result.reason.message}`)
        debug.enabled && console.error(result.reason)
      } else {
        console.error(`Failed to bring app up: ${result.reason}`)
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
  await resetState()
  await generateState()
  await bringUpNewAndChangedApps()
  await teardownDeletedApps()
  await finalizeState()
}

await main()
