import { readdir } from 'fs'
type TFile = {
  name: string
  path: string
}
export default function getDirectory(path: string): Promise<TFile[]> {
  return new Promise((resolve, reject) => {
    readdir(path, (err, files) => {
      if (err) reject(err)
      resolve(
        files
          .filter((filename) => filename.includes('cdb'))
          .map((filename) => ({
            name: filename.split('.')[0],
            path: `${path}/${filename}`
          }))
      )
    })
  })
}
