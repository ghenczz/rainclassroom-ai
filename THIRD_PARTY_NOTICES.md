# 第三方组件与资源说明

本项目使用或参考了以下第三方资源。各资源的版权归其原作者所有。

## Noto Sans SC / Noto Sans CJK

- 用途：生成 `src/services/font-reference-index.json` 中的参考字形签名索引，用于匹配雨课堂题目字体的字形轮廓。
- 版权：Copyright 2014-2021 Adobe (http://www.adobe.com/)，保留字体名称 “Source”。
- 许可证：SIL Open Font License, Version 1.1 (OFL-1.1)。
- 许可证全文：https://openfontlicense.org/open-font-license-official-text/
- 说明：本仓库**不包含** Noto Sans SC 的字体文件，只包含根据其字形轮廓生成的签名索引。该索引用于字符匹配，不包含可还原为字体的轮廓数据。

## opentype.js

- 用途：解析 TTF 字体，读取 `cmap` 和字形路径。
- 版权：Copyright 2015 Frederik De Bleser and opentype.js contributors。
- 许可证：MIT。
- 项目地址：https://github.com/opentypejs/opentype.js

## esbuild

- 用途：构建时打包 TypeScript。
- 许可证：MIT。
- 项目地址：https://github.com/evanw/esbuild

## TypeScript

- 用途：类型检查与编译。
- 许可证：Apache-2.0。
- 项目地址：https://github.com/microsoft/TypeScript

## 商标与平台说明

“长江雨课堂”“学堂在线”“DeepSeek”等名称和商标归其各自权利人所有。

本项目是非官方开源项目，与长江雨课堂、学堂在线、DeepSeek 及其关联公司没有隶属、授权或合作关系。
