import { Injectable } from '@nestjs/common';
import * as sharp from 'sharp';
import * as path from 'path';
import { Bundle } from '../types/bundle.type';

interface FontRatios {
  baseFontRatio: number; // Базовый коэффициент от ширины
  minFontRatio: number; // Минимальный коэффициент от ширины
}

interface TextPositionConfig {
  maxY: number;
  minY: number;
  maxFontSize: number;
  minFontSize: number;
}

@Injectable()
export class ImageProcessingService {
  private readonly TEXT_COLOR = '#987c4b';
  private readonly FONT_PATH = path.join(
    process.cwd(),
    'src',
    'assets',
    'fonts',
    'MULLEREXTRABOLD.TTF',
  );

  private calculateFontSize(
    nickname: string,
    width: number,
    ratios: FontRatios = {
      baseFontRatio: 0.075,
      minFontRatio: 0.032,
    },
  ): number {
    // Рассчитываем базовый и минимальный размер на основе ширины
    const baseSize = Math.round(width * ratios.baseFontRatio);
    const minSize = Math.round(width * ratios.minFontRatio);

    // Фиксированные брейкпоинты
    const breakpoints = [
      { length: 1, scale: 1 },
      { length: 3, scale: 0.98 },
      { length: 4, scale: 0.96 },
      { length: 6, scale: 0.84 },
      { length: 8, scale: 0.64 },
      { length: 10, scale: 0.5 },
      // { length: 12, scale: 0.42 },
      { length: 14, scale: 0.44 },
      // { length: 16, scale: 0.34 },
      { length: 18, scale: 0.36 },
      { length: 20, scale: 0.3 },
      { length: 22, scale: 0.28 },
      // { length: 24, scale: 0.26 },
      { length: 26, scale: 0.24 },
      // { length: 28, scale: 0.22 },
      { length: 30, scale: 0.2 },
      { length: 32, scale: 0.18 },
    ];
    // Находим подходящий масштаб
    let scale = breakpoints[breakpoints.length - 1].scale;
    for (const breakpoint of breakpoints) {
      if (nickname.length <= breakpoint.length) {
        scale = breakpoint.scale;
        break;
      }
    }

    // Рассчитываем итоговый размер
    const size = Math.round(baseSize * scale);
    return Math.max(size, minSize);
  }

  private calculateTextPosition(
    fontSize: number,
    config: TextPositionConfig = {
      maxY: 420,
      minY: 360,
      maxFontSize: 144,
      minFontSize: 64,
    },
  ): number {
    // Линейная интерполяция между maxY и minY на основе размера шрифта
    const position =
      config.maxY -
      ((config.maxY - config.minY) * (config.maxFontSize - fontSize)) /
        (config.maxFontSize - config.minFontSize);
    return Math.round(position); // Округляем до целого числа
  }

  async createBundle(nickname: string): Promise<Bundle> {
    try {
      const avatar = await this.createAvatar(nickname);
      const coverVk = await this.createCoverVk(nickname);
      const coverX = await this.createCoverX(nickname);

      return {
        avatar,
        coverVk,
        coverX,
      };
    } catch (error) {
      console.error('Error creating bundle:', error);
      throw error;
    }
  }

  private async createAvatar(nickname: string): Promise<Buffer> {
    const templatePath = path.join(
      process.cwd(),
      'src',
      'assets',
      'templates',
      'avatar.png',
    );

    try {
      await sharp(templatePath).metadata();
    } catch (error) {
      console.error(
        `Ошибка при чтении шаблона аватара: ${templatePath}`,
        error,
      );
      throw new Error(`Шаблон аватара не найден: ${templatePath}`);
    }

    const width = 1080;
    const height = 1080;
    const containerWidth = 840;

    // Рассчитываем размер шрифта на основе контейнера, а не всего изображения
    const fontSize = this.calculateFontSize(nickname, containerWidth, {
      baseFontRatio: 0.28,
      minFontRatio: 0.064,
    });

    const svgText = `
      <svg width="${width}" height="${height}">
        <defs>
          <style>
            @font-face {
              font-family: 'Muller';
              src: url('${this.FONT_PATH}');
            }
            .nickname { 
              font-family: 'Muller', Arial, sans-serif; 
              font-size: ${fontSize}px; 
              font-weight: 800;
              letter-spacing: -0.04em;
            }
          </style>
        </defs>
          <text 
            x="50%"
            y="50%"
            text-anchor="middle"
            alignment-baseline="central"
            dominant-baseline="central"
            dy="${fontSize * 0.28}px"
            class="nickname"
            fill="${this.TEXT_COLOR}"
            font-weight="800"
            letter-spacing="-0.04em"
          >${nickname}</text>
      </svg>`;

    return await sharp(templatePath)
      .composite([
        {
          input: Buffer.from(svgText),
          top: 0,
          left: 0,
        },
      ])
      .png()
      .toBuffer();
  }

  private async createCoverVk(nickname: string): Promise<Buffer> {
    const templatePath = path.join(
      process.cwd(),
      'src',
      'assets',
      'templates',
      'cover_vk.png',
    );
    const width = 1920;
    const height = 768;

    // Вычисляем размер шрифта и позицию
    const fontSize = this.calculateFontSize(nickname, width, {
      baseFontRatio: 0.12,
      minFontRatio: 0.05,
    });

    const yPosition = this.calculateTextPosition(fontSize, {
      maxY: 410,
      minY: 360,
      maxFontSize: 144,
      minFontSize: 64,
    });

    const svgText = `
       <svg width="${width}" height="${height}">
        <defs>
          <style>
            @font-face {
              font-family: 'Muller';
              src: url('${this.FONT_PATH}');
            }
            .nickname { 
              font-family: 'Muller', Arial, sans-serif; 
              font-size: ${fontSize}px; 
              font-weight: 800;
              letter-spacing: -0.04em;
            }
          </style>
        </defs>
        <text 
          x="${width - 44}"
          y="${yPosition}"
          text-anchor="end"
          dominant-baseline="text-before-edge"
          class="nickname"
          fill="${this.TEXT_COLOR}"
          font-weight="800"
          letter-spacing="-0.04em"
        >${nickname}</text>
      </svg>`;

    return await sharp(templatePath)
      .composite([
        {
          input: Buffer.from(svgText),
          top: 0,
          left: 0,
        },
      ])
      .png()
      .toBuffer();
  }

  private async createCoverX(nickname: string): Promise<Buffer> {
    const templatePath = path.join(
      process.cwd(),
      'src',
      'assets',
      'templates',
      'cover_x.png',
    );
    const width = 1920;
    const height = 640;

    // Вычисляем размер шрифта
    const fontSize = this.calculateFontSize(nickname, width, {
      baseFontRatio: 0.112,
      minFontRatio: 0.06,
    });
    const yPosition = this.calculateTextPosition(fontSize, {
      maxY: 460,
      minY: 430,
      maxFontSize: 144,
      minFontSize: 64,
    });

    const svgText = `
      <svg width="${width}" height="${height}">
        <defs>
          <style>
            @font-face {
              font-family: 'Muller';
              src: url('${this.FONT_PATH}');
            }
            .nickname { 
              font-family: 'Muller', Arial, sans-serif; 
              font-size: ${fontSize}px; 
              font-weight: 800;
              letter-spacing: -0.04em;
            }
          </style>
        </defs>
        <text 
          x="${width - 96}"
          y="${yPosition}"
          text-anchor="end"
          dominant-baseline="text-after-edge"
          class="nickname"
          fill="${this.TEXT_COLOR}"
          font-weight="800"
          letter-spacing="-0.04em"
        >${nickname}</text>
      </svg>`;

    return await sharp(templatePath)
      .composite([
        {
          input: Buffer.from(svgText),
          top: 0,
          left: 0,
        },
      ])
      .png()
      .toBuffer();
  }
}
