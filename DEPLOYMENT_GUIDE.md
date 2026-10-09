# 今视广告线上展馆 - 部署指南

本文档提供了将该网站部署到生产环境的详细步骤和最佳实践。

## 1. 部署前准备

### 1.1 文件结构检查
确保以下文件和目录存在且完整：

```
3D/
├── index.html              # 网站主页面
├── model-viewer.html       # 3D模型查看器页面
├── css/
│   ├── style.css           # 首页样式
│   └── model-viewer.css    # 查看器样式（独立，避免两边互相影响）
├── js/
│   ├── main.js             # 首页交互 + 3D 场景 + 站点配置
│   ├── three.min.js        # Three.js库
│   ├── OrbitControls.js    # 轨道控制器
│   └── GLTFLoader.js       # glTF / glb 模型加载器
├── images/                 # 图片资源（含首屏全景贴图 panorama.jpg）
└── model/                  # 3D模型资源
```

> 部署时请勿上传 `_legacy/` 目录，那是改造前的原始文件备份。

### 1.2 资源优化

#### 1.2.1 图片优化
- 压缩所有JPEG和PNG图片
- 对于SVG文件，确保已优化（移除注释和不必要的空格）

#### 1.2.2 JavaScript优化
- 确认已使用压缩版本的库文件（*.min.js）
- 考虑合并多个JS文件以减少HTTP请求

## 2. 选择部署方式

### 2.1 静态网站托管服务

#### GitHub Pages
1. 将项目推送到GitHub仓库
2. 在仓库设置中启用GitHub Pages
3. 选择主分支作为源

#### Netlify
1. 在Netlify注册账号
2. 连接GitHub仓库
3. 配置构建设置（不需要构建命令，直接部署）
4. 部署网站

#### Vercel
1. 在Vercel注册账号
2. 导入项目仓库
3. 配置项目设置
4. 部署网站

### 2.2 自托管服务器

#### Nginx配置

1. 安装Nginx
2. 创建配置文件 `/etc/nginx/sites-available/3dconnecter`：

```nginx
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;
    
    root /var/www/3dconnecter;
    index index.html;
    
    location / {
        try_files $uri $uri/ /index.html;
    }
    
    # 静态资源缓存控制
    location ~* \.(jpg|jpeg|png|gif|ico|css|js|svg|glb|gltf|obj)$ {
        expires 1y;
        add_header Cache-Control "public, max-age=31536000";
    }
    
    # 启用Gzip压缩
    gzip on;
    gzip_comp_level 5;
    gzip_min_length 256;
    gzip_proxied any;
    gzip_vary on;
    
    gzip_types
        application/javascript
        application/json
        text/css
        text/plain;
}
```

3. 创建符号链接启用配置：
```bash
ln -s /etc/nginx/sites-available/3dconnecter /etc/nginx/sites-enabled/
```

4. 测试配置并重启Nginx：
```bash
nginx -t
nginx -s reload
```

## 3. 部署步骤

1. **准备部署目录**：
   - 创建部署目录（如 `/var/www/3dconnecter`）
   - 确保Web服务器用户有权限访问该目录

2. **上传文件**：
   - 使用FTP、SFTP或Git将所有文件上传到部署目录
   - 确保目录结构保持不变

3. **文件权限设置**：
   - 确保所有静态文件可读
   - 对于Nginx，通常使用以下权限：
     ```bash
     chown -R www-data:www-data /var/www/3dconnecter
     chmod -R 755 /var/www/3dconnecter
     ```

4. **配置域名**：
   - 将域名DNS记录指向您的服务器IP
   - 配置SSL证书（推荐使用Let's Encrypt）

## 4. 部署后检查

部署完成后，执行以下检查确保网站正常运行：

1. **访问网站**：检查主页和模型查看器页面是否正常加载
2. **3D模型功能**：测试3D场景是否正确显示和交互
3. **响应式设计**：在不同设备尺寸上测试网站
4. **控制台错误**：检查浏览器控制台是否有任何JavaScript错误
5. **加载性能**：使用浏览器开发工具检查加载时间和资源大小

## 5. 故障排除

### 5.1 常见问题

- **3D场景不显示**：检查Three.js库是否正确加载，浏览器控制台是否有错误
- **模型加载失败**：确认模型文件路径正确，文件格式受支持
- **跨域问题**：配置服务器允许跨域资源共享（CORS）
- **性能问题**：优化图片和3D模型，考虑减少几何体复杂度

### 5.2 服务器配置

如果遇到资源加载问题，确保服务器正确配置了MIME类型：

```nginx
# 在Nginx配置中添加
types {
    application/octet-stream glb;
    application/json gltf;
    application/javascript js;
    text/css css;
    image/svg+xml svg;
}
```

## 6. 性能优化建议

1. **CDN使用**：考虑使用CDN分发静态资源
2. **延迟加载**：为3D模型和非关键资源实现延迟加载
3. **预加载关键资源**：
   ```html
   <link rel="preload" href="js/three.min.js" as="script">
   ```
4. **HTTP/2支持**：确保服务器支持HTTP/2
5. **定期更新缓存**：在静态资源URL中添加版本号或哈希值

## 7. 联系方式

如有部署相关问题，请联系：
- 邮箱：info@3dconnecter.cn
- 电话：400-123-4567

---

*最后更新时间：2026年*