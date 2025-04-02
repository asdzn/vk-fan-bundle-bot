import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  VK,
  CommentContext,
  ContextDefaultState,
  PhotoAttachment,
} from 'vk-io';
import { ImageProcessingService } from '../image-processing/image-processing.service';
import { Bundle } from '../types/bundle.type';
import fetch from 'node-fetch';
import * as FormData from 'form-data';
import * as archiver from 'archiver';

@Injectable()
export class VkService implements OnModuleInit {
  #vk: VK;
  #vkUser: VK;
  #configService: ConfigService;

  // Функция для создания случайной задержки от 1 до 3 секунд
  private async delay(): Promise<void> {
    const delayMs = Math.floor(Math.random() * 2000) + 1000; // 1000-3000ms
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  constructor(
    configService: ConfigService,
    private readonly imageProcessingService: ImageProcessingService,
  ) {
    this.#configService = configService;

    const groupToken = this.#configService.get<string>('VK_GROUP_TOKEN');
    const userToken = this.#configService.get<string>('VK_USER_TOKEN');

    if (!groupToken || !userToken) {
      throw new Error('VK tokens are not defined in environment variables');
    }

    // Инстанс для работы от имени группы (для прослушивания событий)
    this.#vk = new VK({
      token: groupToken,
      pollingGroupId: Math.abs(
        Number(this.#configService.get<string>('GROUP_ID')),
      ),
    });

    // Инстанс для работы от имени пользователя (для загрузки фото)
    this.#vkUser = new VK({
      token: userToken,
    });
  }

  async onModuleInit() {
    try {
      await this.#startPolling();
    } catch (error) {
      console.error('Failed to start VK polling:', error);
    }
  }

  #startPolling = async () => {
    console.log('Starting VK polling...');

    this.#vk.updates.on('message_new', (context) => {
      console.log('Новое сообщение:', context);
    });

    this.#vk.updates.on('wall_post_new', (context) => {
      console.log('Новый пост:', context);
    });

    this.#vk.updates.on(
      'wall_reply_new',
      async (context: CommentContext<ContextDefaultState>) => {
        console.log('=== Новый комментарий ===');
        console.log('Текст:', context.text);
        console.log('ID поста:', context.wallPostId);
        console.log('Полный контекст:', JSON.stringify(context, null, 2));

        try {
          const targetPostId =
            this.#configService.get<string>('TARGET_POST_ID') || '';
          console.log('Целевой пост из конфига:', targetPostId);

          const postId = context.objectId?.toString() || '';
          console.log('Сравниваем:', {
            current: postId,
            target: targetPostId,
            matches: postId === targetPostId,
          });

          if (context.text && postId === targetPostId) {
            const nickname = this.#extractNickname(context.text);
            console.log('Извлеченный ник:', nickname);
            if (nickname) {
              await this.#handleComment(context, nickname);
            } else {
              console.log('Ник не найден в комментарии');
            }
          } else {
            console.log('Комментарий не соответствует условиям');
          }
        } catch (error) {
          console.error('Error processing comment:', error);
        }
      },
    );

    await this.#vk.updates.start();
    console.log('VK polling started successfully');
  };

  #extractNickname = (text: string): string | null => {
    // Массив возможных форматов
    const patterns = [
      /ник:\s*(.*?)(?:\n|$)/i, // ник: nickname или Ник: nickname
      /ник\s+(.*?)(?:\n|$)/i, // ник nickname или Ник nickname
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        const nickname = match[1].trim();
        console.log('Найден ник:', nickname);
        return nickname ? this.#sanitizeNickname(nickname) : null;
      }
    }

    console.log('Не удалось найти ник в допустимом формате');
    return null;
  };

  #sanitizeNickname = (nickname: string): string => {
    return nickname
      .replace(/[<>{}()/\\]/g, '')
      .trim()
      .substring(0, 32);
  };

  #sendReply = async (
    context: CommentContext<ContextDefaultState>,
    message: string,
  ): Promise<void> => {
    await this.#vk.api.wall.createComment({
      owner_id: context.ownerId,
      post_id: context.objectId,
      reply_to_comment: context.id,
      message: message,
    });
  };

  private async uploadPhoto(photo: Buffer, groupId: number) {
    try {
      await this.delay(); // Добавляем задержку перед запросом
      const uploadServer = await this.#vkUser.api.photos.getWallUploadServer({
        group_id: groupId,
      });

      if (!uploadServer || !uploadServer.upload_url) {
        throw new Error('Failed to get upload server URL');
      }

      const form =
        `--boundary\r\n` +
        `Content-Disposition: form-data; name="photo"; filename="photo.png"\r\n` +
        `Content-Type: image/png\r\n\r\n`;

      const endForm = '\r\n--boundary--\r\n';

      const formBuffer = Buffer.concat([
        Buffer.from(form, 'utf-8'),
        photo,
        Buffer.from(endForm, 'utf-8'),
      ]);

      const uploadResponse = await fetch(uploadServer.upload_url, {
        method: 'POST',
        headers: {
          'Content-Type': 'multipart/form-data; boundary=boundary',
        },
        body: formBuffer,
      });

      if (!uploadResponse.ok) {
        throw new Error(`Upload failed with status: ${uploadResponse.status}`);
      }

      const uploadResult = await uploadResponse.json();

      if (!uploadResult.photo || !uploadResult.server || !uploadResult.hash) {
        throw new Error('Invalid upload result format');
      }

      await this.delay(); // Добавляем задержку перед сохранением фото
      const [savedPhoto] = await this.#vkUser.api.photos.saveWallPhoto({
        group_id: groupId,
        photo: uploadResult.photo,
        server: uploadResult.server,
        hash: uploadResult.hash,
      });

      return savedPhoto;
    } catch (error) {
      console.error('Ошибка при загрузке фото:', error.message);
      throw error;
    }
  }

  private async createZipArchive(
    bundle: Bundle,
    nickname: string,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const archive = archiver('zip', {
        zlib: { level: 9 },
      });

      const chunks: Buffer[] = [];

      archive.on('data', (chunk) => chunks.push(chunk));
      archive.on('end', () => resolve(Buffer.concat(chunks)));
      archive.on('error', (err) => reject(new Error(err.message)));

      // Добавляем файлы в архив
      archive.append(bundle.avatar, { name: `${nickname}_avatar.png` });
      archive.append(bundle.coverVk, { name: `${nickname}_cover_vk.png` });
      archive.append(bundle.coverX, { name: `${nickname}_cover_x.png` });

      archive.finalize();
    });
  }

  private async uploadDocument(
    file: Buffer,
    fileName: string,
    groupId: number,
  ) {
    try {
      await this.delay(); // Добавляем задержку перед запросом
      const uploadServer = await this.#vkUser.api.docs.getMessagesUploadServer({
        type: 'doc',
        peer_id: groupId,
      });

      if (!uploadServer || !uploadServer.upload_url) {
        throw new Error('Failed to get upload server URL');
      }

      const form = new FormData();
      form.append('file', file, {
        filename: fileName,
        contentType: 'application/zip',
        knownLength: file.length,
      });

      const uploadResponse = await fetch(uploadServer.upload_url, {
        method: 'POST',
        headers: form.getHeaders(),
        body: form,
      });

      if (!uploadResponse.ok) {
        throw new Error(`Upload failed with status: ${uploadResponse.status}`);
      }

      const uploadResult = await uploadResponse.json();

      await this.delay(); // Добавляем задержку перед сохранением документа
      const savedDoc = await this.#vkUser.api.docs.save({
        file: uploadResult.file,
        title: fileName,
      });

      return savedDoc;
    } catch (error) {
      console.error('Ошибка при загрузке документа:', error.message);
      throw error;
    }
  }

  #handleComment = async (
    context: CommentContext<ContextDefaultState>,
    nickname: string,
  ): Promise<void> => {
    try {
      const bundle: Bundle =
        await this.imageProcessingService.createBundle(nickname);
      const groupId = Number(this.#configService.get<string>('GROUP_ID'));

      // Загружаем изображения как фото для превью
      const avatarUpload = await this.uploadPhoto(
        bundle.avatar,
        Math.abs(groupId),
      );
      await this.delay(); // Добавляем задержку между загрузками фото
      const coverVkUpload = await this.uploadPhoto(
        bundle.coverVk,
        Math.abs(groupId),
      );
      await this.delay(); // Добавляем задержку между загрузками фото
      const coverXUpload = await this.uploadPhoto(
        bundle.coverX,
        Math.abs(groupId),
      );

      // Загружаем все изображения как документы
      const coverVkDoc = await this.uploadDocument(
        bundle.coverVk,
        `${nickname}_cover_vk.png`,
        groupId,
      );
      await this.delay(); // Добавляем задержку между загрузками документов
      const coverXDoc = await this.uploadDocument(
        bundle.coverX,
        `${nickname}_cover_x.png`,
        groupId,
      );
      await this.delay(); // Добавляем задержку между загрузками документов
      const avatarDoc = await this.uploadDocument(
        bundle.avatar,
        `${nickname}_avatar.png`,
        groupId,
      );

      // Отправляем первое сообщение с обложками
      const coverAttachments = [
        `doc${coverVkDoc.doc.owner_id}_${coverVkDoc.doc.id}`,
        `doc${coverXDoc.doc.owner_id}_${coverXDoc.doc.id}`,
      ].join(',');

      await this.delay(); // Добавляем задержку перед отправкой комментария
      await this.#vkUser.api.wall.createComment({
        owner_id: context.ownerId,
        post_id: context.objectId,
        reply_to_comment: context.id,
        from_group: Math.abs(groupId),
        message: `Ваш бандл готов! Обложки для ${nickname}:`,
        attachments: coverAttachments,
      });

      // Создаем архив
      const zipBuffer = await this.createZipArchive(bundle, nickname);
      const zipDoc = await this.uploadDocument(
        zipBuffer,
        `bundle_${nickname}.zip`,
        groupId,
      );

      // Отправляем второе сообщение с аватаром и архивом
      const finalAttachments = [
        `doc${avatarDoc.doc.owner_id}_${avatarDoc.doc.id}`,
        `doc${zipDoc.doc.owner_id}_${zipDoc.doc.id}`,
      ].join(',');

      await this.delay(); // Добавляем задержку перед отправкой второго комментария
      await this.#vkUser.api.wall.createComment({
        owner_id: context.ownerId,
        post_id: context.objectId,
        reply_to_comment: context.id,
        from_group: Math.abs(groupId),
        message: 'Аватар и архив со всеми файлами:',
        attachments: finalAttachments,
      });
    } catch (error) {
      console.error('Ошибка при обработке комментария:', error.message);
      await this.#sendReply(context, 'Произошла ошибка при создании бандла');
    }
  };
}
