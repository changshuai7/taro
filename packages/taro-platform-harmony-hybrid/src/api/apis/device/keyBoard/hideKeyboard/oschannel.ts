import Taro from '@tarojs/taro'

let inputMethod

try {
  // @ts-ignore
  inputMethod = requireNapi('inputMethod')
} catch (error) {}

export const hideKeyboard:typeof Taro.hideKeyboard = () => {
  return new Promise((resolve, reject) => {
    try {
      const inputMethodController = inputMethod.getController()
      inputMethodController
        .hideTextInput()
        .then(() => {
          resolve({ errMsg: 'ok' })
        })
        .catch((err: any) => {
          console.error('[OsChannel] Failed to hideSoftKeyboard: ' + JSON.stringify(err))
          reject(err)
        })
    } catch (exception) {
      console.error('[OsChannel] Failed to get inputMethod Controller. Cause: ' + JSON.stringify(exception))
      reject(exception)
    }
  })
}
