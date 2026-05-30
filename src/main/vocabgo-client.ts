/**
 * VocabgoClient - vocabgo.com API 客户端
 * 封装所有 API 调用，包含签名生成、响应解密
 */

import got from 'got'
import * as https from 'https'
import * as http from 'http'
import { sign, decrypt } from './crypto'
import type { Answer } from './types'

const VERSION = '2.7.0.260507_01'
const BASE = 'https://app.vocabgo.com/studentv1/api'
const STUDENT_BASE = 'https://app.vocabgo.com/student/api'

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 NetType/WIFI MicroMessenger/7.0.20.1781(0x6700143B) WindowsWechat(0x63090a13) UnifiedPCWindowsWechat(0xf254173b) XWEB/19027 Flue'

/**
 * 直连 agent，绕过系统代理
 * 防止应用自身的 API 请求被自己的 MITM 代理拦截
 */
const directAgent = {
  http: new http.Agent(),
  https: new https.Agent(),
}

/** 当前时间戳（毫秒） */
function _ms(): number {
  return Date.now()
}

export class VocabgoClient {
  private headers: Record<string, string>

  constructor(usertoken: string, abc: string, authV: string) {
    this.headers = {
      host: 'app.vocabgo.com',
      usertoken,
      abc,
      'authorization-v': authV,
      'x-requested-with': 'XMLHttpRequest',
      accept: 'application/json, text/plain, */*',
      'content-type': 'application/json',
      origin: 'https://app.vocabgo.com',
      referer: 'https://app.vocabgo.com/student/',
      'user-agent': DEFAULT_UA,
    }
  }

  private async _get(
    path: string,
    params: Record<string, unknown>,
    base: string = BASE
  ): Promise<Record<string, unknown>> {
    const fullParams: Record<string, unknown> = {
      ...params,
      timestamp: _ms(),
      version: VERSION,
      app_type: 1,
    }
    const resp = await got(base + path, {
      method: 'GET',
      headers: this.headers,
      searchParams: fullParams as Record<string, string | number>,
      timeout: { request: 20000 },
      responseType: 'json',
      agent: directAgent,
    })
    return decrypt(resp.body as Record<string, unknown>)
  }

  private async _post(
    path: string,
    body: Record<string, unknown>,
    base: string = BASE
  ): Promise<Record<string, unknown>> {
    const fullBody: Record<string, unknown> = {
      ...body,
      timestamp: _ms(),
      version: VERSION,
    }
    fullBody.sign = sign(fullBody)
    fullBody.app_type = 1

    const resp = await got(base + path, {
      method: 'POST',
      headers: this.headers,
      json: fullBody,
      timeout: { request: 20000 },
      responseType: 'json',
      agent: directAgent,
    })
    return decrypt(resp.body as Record<string, unknown>)
  }

  // ── 班级任务接口 ──

  async pageTask(page = 1, size = 50, searchType = '0'): Promise<Record<string, unknown>> {
    return this._post('/Student/ClassTask/PageTask', {
      search_type: searchType,
      page_count: page,
      page_size: size,
    })
  }

  async taskInfo(taskId: number, releaseId: number): Promise<Record<string, unknown>> {
    return this._get('/Student/ClassTask/Info', {
      task_id: taskId,
      release_id: releaseId,
    })
  }

  async choseWordList(taskId: number): Promise<Record<string, unknown>> {
    return this._get('/Student/ClassTask/ChoseWordList', {
      task_id: taskId,
      task_type: 1,
    })
  }

  async submitChoseWord(
    taskId: number,
    wordMap: Record<string, string[]>
  ): Promise<Record<string, unknown>> {
    return this._post('/Student/ClassTask/SubmitChoseWord', {
      task_id: taskId,
      word_map: wordMap,
      chose_err_item: 1,
      reset_chose_words: 1,
    })
  }

  async startAnswer(taskId: number, releaseId: number): Promise<Record<string, unknown>> {
    return this._get('/Student/ClassTask/StartAnswer', {
      task_id: taskId,
      task_type: 1,
      release_id: releaseId,
      opt_img_w: 2300,
      opt_font_size: 128,
      opt_font_c: '#000000',
      it_img_w: 2702,
      it_font_size: 144,
    })
  }

  async verify(topicCode: string, answer: Answer): Promise<Record<string, unknown>> {
    return this._post('/Student/ClassTask/VerifyAnswer', {
      topic_code: topicCode,
      answer,
    })
  }

  async submit(topicCode: string, timeSpent: number): Promise<Record<string, unknown>> {
    return this._post('/Student/ClassTask/SubmitAnswerAndSave', {
      topic_code: topicCode,
      time_spent: timeSpent,
      opt_img_w: 2300,
      opt_font_size: 128,
      opt_font_c: '#000000',
      it_img_w: 2702,
      it_font_size: 144,
    })
  }

  async signin(): Promise<Record<string, unknown>> {
    return this._post('/Student/TaskStudentSignin/Do', {})
  }

  // ── 自学任务接口 ──

  async studyTaskList(courseId = 'CET4_v2'): Promise<Record<string, unknown>> {
    return this._get('/Student/StudyTask/List', { course_id: courseId }, STUDENT_BASE)
  }

  async studyStartTask(
    courseId: string,
    listId: string,
    taskType = 3,
    grade = 2
  ): Promise<Record<string, unknown>> {
    return this._post(
      '/Student/StudyTask/StartTask',
      { course_id: courseId, list_id: listId, task_type: taskType, grade },
      STUDENT_BASE
    )
  }

  async studyTaskInfo(
    taskId: number,
    courseId: string,
    listId: string,
    taskType = 3,
    grade = 2
  ): Promise<Record<string, unknown>> {
    return this._get(
      '/Student/StudyTask/Info',
      { task_id: taskId, course_id: courseId, list_id: listId, task_type: taskType, grade },
      STUDENT_BASE
    )
  }

  async studyChoseWordList(
    taskId: number,
    courseId: string,
    listId: string,
    taskType = 3,
    grade = 2
  ): Promise<Record<string, unknown>> {
    return this._get(
      '/Student/StudyTask/ChoseWordList',
      { task_id: taskId, course_id: courseId, list_id: listId, task_type: taskType, grade },
      STUDENT_BASE
    )
  }

  async studySubmitChoseWord(
    taskId: number,
    courseId: string,
    listId: string,
    wordMap: Record<string, string[]>,
    taskType = 3,
    grade = 2
  ): Promise<Record<string, unknown>> {
    return this._post(
      '/Student/StudyTask/SubmitChoseWord',
      {
        task_id: taskId,
        task_type: taskType,
        grade,
        course_id: courseId,
        list_id: listId,
        word_map: wordMap,
        chose_err_item: 1,
        reset_chose_words: 1,
      },
      STUDENT_BASE
    )
  }

  async studyStartAnswer(
    taskId: number,
    courseId: string,
    listId: string,
    taskType = 3,
    grade = 2
  ): Promise<Record<string, unknown>> {
    return this._get(
      '/Student/StudyTask/StartAnswer',
      {
        task_id: taskId,
        task_type: taskType,
        grade,
        course_id: courseId,
        list_id: listId,
        opt_img_w: 2300,
        opt_font_size: 128,
        opt_font_c: '#000000',
        it_img_w: 2702,
        it_font_size: 144,
      },
      STUDENT_BASE
    )
  }

  async studyVerify(topicCode: string, answer: Answer): Promise<Record<string, unknown>> {
    return this._post(
      '/Student/StudyTask/VerifyAnswer',
      { topic_code: topicCode, answer },
      STUDENT_BASE
    )
  }

  async studySubmit(topicCode: string, timeSpent: number): Promise<Record<string, unknown>> {
    return this._post(
      '/Student/StudyTask/SubmitAnswerAndSave',
      {
        topic_code: topicCode,
        time_spent: timeSpent,
        opt_img_w: 2300,
        opt_font_size: 128,
        opt_font_c: '#000000',
        it_img_w: 2702,
        it_font_size: 144,
      },
      STUDENT_BASE
    )
  }
}
