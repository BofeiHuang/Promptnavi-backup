from typing import Dict, List, Any, Optional
from openai import OpenAI
import os
from pathlib import Path
from datetime import datetime
import logging
import json
import torch
from PIL import Image
import numpy as np
from io import BytesIO
import base64
from transformers import CLIPProcessor, CLIPModel

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

if not logger.handlers:
    handler = logging.StreamHandler()
    formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    handler.setFormatter(formatter)
    logger.addHandler(handler)

class AIService:
    def __init__(self, client: OpenAI = None):

        self.client = client or OpenAI(api_key=os.getenv('OPENAI_API_KEY'))
        self.device = "cuda" if torch.cuda.is_available() else "cpu"


        try:
            self.clip_model = CLIPModel.from_pretrained("openai/clip-vit-base-patch32")
            self.clip_processor = CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32")
            self.clip_model.to(self.device)
            logger.info(f"CLIP model loaded on {self.device}")
        except Exception as e:
            logger.warning(f"Failed to load CLIP model: {e}")
            self.clip_model = None
            self.clip_processor = None


        self.sd_pipeline = None
        self.sd_available = self._check_sd_availability()


        self.feature_types = {
            'color': {'name': 'Color', 'descriptors': []},
            'style': {'name': 'Style', 'descriptors': []},
            'composition': {'name': 'Composition', 'descriptors': []},
            'lighting': {'name': 'Lighting', 'descriptors': []},
            'mood': {'name': 'Mood', 'descriptors': []},
            'object': {'name': 'Object', 'descriptors': []},
            'perspective': {'name': 'Perspective', 'descriptors': []},
            'detail': {'name': 'Detail', 'descriptors': []},
            'texture': {'name': 'Texture', 'descriptors': []}
        }

    def _check_sd_availability(self) -> bool:
        """检查 Stable Diffusion 本地可用性"""
        try:
            from diffusers import StableDiffusionPipeline
            logger.info("diffusers library available, Stable Diffusion can be loaded locally")
            return True
        except ImportError:
            logger.warning("diffusers library not installed. Install with: pip install diffusers transformers accelerate")
            return False

    def _init_stable_diffusion_local(self):
        """初始化本地 Stable Diffusion 管道"""
        if self.sd_pipeline is None:
            try:
                from diffusers import StableDiffusionPipeline
                logger.info("Loading Stable Diffusion pipeline locally...")


                model_id = os.getenv('SD_MODEL_ID', 'runwayml/stable-diffusion-v1-5')
                logger.info(f"Loading model: {model_id}")

                self.sd_pipeline = StableDiffusionPipeline.from_pretrained(
                    model_id,
                    torch_dtype=torch.float16 if torch.cuda.is_available() else torch.float32,
                    safety_checker=None,
                    requires_safety_checker=False,
                    use_safetensors=True
                )

                if torch.cuda.is_available():
                    self.sd_pipeline = self.sd_pipeline.to("cuda")


                    try:
                        self.sd_pipeline.enable_attention_slicing()
                        logger.info("Attention slicing enabled")
                    except AttributeError:
                        logger.info("Attention slicing not available in this version")

                    try:
                        self.sd_pipeline.enable_model_cpu_offload()
                        logger.info("Model CPU offload enabled")
                    except AttributeError:
                        logger.info("Model CPU offload not available in this version")


                    try:
                        self.sd_pipeline.enable_xformers_memory_efficient_attention()
                        logger.info("xformers memory optimization enabled")
                    except Exception as e:
                        logger.info(f"xformers not available: {e}")

                logger.info("Stable Diffusion pipeline loaded successfully")
            except Exception as e:
                logger.error(f"Failed to load Stable Diffusion pipeline: {e}")
                raise

    def _generate_with_stable_diffusion_local(self, prompt: str, size: str = "512x512") -> str:
        """使用本地 Stable Diffusion 生成图像"""
        try:
            self._init_stable_diffusion_local()


            width, height = map(int, size.split('x'))


            width = (width // 8) * 8
            height = (height // 8) * 8

            logger.info(f"Generating image locally with Stable Diffusion: {prompt}")
            logger.info(f"Size: {width}x{height}")


            negative_prompt = "blurry, low quality, distorted, ugly, bad anatomy, bad hands, bad proportions, poorly drawn, deformed, mutated, extra limbs, missing limbs, watermark, signature, text"


            generator = torch.Generator(device=self.device).manual_seed(
                torch.randint(0, 2**32 - 1, (1,)).item()
            )


            with torch.autocast("cuda" if torch.cuda.is_available() else "cpu"):
                result = self.sd_pipeline(
                    prompt=prompt,
                    negative_prompt=negative_prompt,
                    width=width,
                    height=height,
                    num_inference_steps=20,
                    guidance_scale=7.5,
                    generator=generator,
                    num_images_per_prompt=1
                )

                image = result.images[0]


            buffer = BytesIO()
            image.save(buffer, format='PNG', quality=95)
            image_b64 = base64.b64encode(buffer.getvalue()).decode()

            return f"data:image/png;base64,{image_b64}"

        except Exception as e:
            logger.error(f"Local Stable Diffusion generation failed: {e}")
            raise

    def analyze_features(self, prompt: str, image_data: Optional[bytes] = None) -> Dict[str, Any]:
        """分析文本提示和可选图像的特征"""
        try:
            if not isinstance(prompt, str) or not prompt.strip():
                raise ValueError("Invalid prompt: must be a non-empty string.")

            if image_data and not isinstance(image_data, (str, bytes)):
                raise ValueError("Invalid image_data: must be base64-encoded string or bytes.")


            logger.info(f"Starting GPT analysis for prompt: {prompt}")
            prompt_features = self.analyze_prompt_with_gpt(prompt)
            logger.info(f"GPT analysis result: {json.dumps(prompt_features, indent=2)}")


            if not prompt_features or not isinstance(prompt_features, dict):
                logger.error("Invalid or empty GPT analysis result")
                raise ValueError("Failed to get valid features from GPT analysis")


            combined_features = dict(prompt_features)


            if image_data and self.clip_model is not None:
                try:
                    logger.info("Starting CLIP image analysis")
                    clip_features = self.analyze_image_with_clip(image_data, prompt_features)


                    for category, features in clip_features.items():
                        if category in combined_features:
                            combined_features[category].update(features)
                        else:
                            combined_features[category] = features

                    logger.info(f"CLIP analysis completed and merged")
                except Exception as e:
                    logger.warning(f"CLIP analysis failed, continuing with GPT results: {e}")


            if not combined_features:
                logger.warning("No features found in analysis")
                return {'success': False, 'error': 'No features found'}


            return {
                'success': True,
                'analysis': combined_features,
                'active_categories': [cat for cat, feat in combined_features.items() if feat]
            }

        except Exception as e:
            logger.error(f"Feature analysis failed: {str(e)}", exc_info=True)
            return {
                'success': False,
                'error': str(e)
            }

    def analyze_prompt_with_gpt(self, prompt: str) -> Dict:
        """使用 GPT 分析文本提示中的视觉特征"""
        try:
            system_prompt = """
Analyze the visual elements in the following prompt.

Output Format Requirements:
1. Return ONLY a JSON object
2. Each category should contain terms with single numerical confidence scores
3. Confidence scores must be between 0.0 and 1.0
4. Do NOT use lists or complex objects for scores

Example of CORRECT format:
{
    "color": {
        "deep blue": 0.9,
        "golden": 0.7
    },
    "style": {
        "impressionist": 0.8
    }
}

Categories to analyze:
- color (Color palette and tones)
- style (Artistic style and technique)
- composition (Layout and arrangement)
- lighting (Light and shadow effects)
- mood (Emotional atmosphere)
- object (Any subject or entity in the scene: cars, people, animals, etc.)
- perspective (Viewpoint and depth)
- detail (Level of detail and complexity)
- texture (Surface qualities)

Rules:
1. Include ONLY categories where features are clearly present
2. Each term MUST have a single numeric score (0.0-1.0)
3. Be specific and precise in terminology
4. Focus on visual and artistic aspects
5. Return valid JSON only
"""

            completion = self.client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.3,
                max_tokens=1000
            )

            response_text = completion.choices[0].message.content.strip()
            logger.info(f"GPT raw response: {response_text}")


            try:
                raw_result = json.loads(response_text)
            except json.JSONDecodeError as e:
                logger.error(f"Failed to parse GPT response as JSON: {e}")

                cleaned_text = response_text.strip()
                if cleaned_text.startswith('```json'):
                    cleaned_text = cleaned_text[7:]
                if cleaned_text.endswith('```'):
                    cleaned_text = cleaned_text[:-3]
                cleaned_text = cleaned_text.strip()

                try:
                    raw_result = json.loads(cleaned_text)
                except json.JSONDecodeError:
                    logger.error(f"Failed to parse cleaned GPT response: {cleaned_text}")
                    return {}


            cleaned_result = {}
            for category, terms in raw_result.items():
                if not isinstance(terms, dict):
                    logger.warning(f"Skipping category {category}: not a dict")
                    continue

                cleaned_terms = {}
                for term, score in terms.items():
                    try:

                        if not isinstance(score, (int, float)):
                            logger.warning(f"Skipping {term}: score is {type(score)}, not a number")
                            continue


                        score_float = float(score)


                        if not 0 <= score_float <= 1:
                            logger.warning(f"Skipping {term}: score {score_float} out of range [0,1]")
                            continue


                        cleaned_terms[str(term)] = score_float

                    except (TypeError, ValueError) as e:
                        logger.warning(f"Error processing score for {term}: {e}")
                        continue


                if cleaned_terms:
                    cleaned_result[category] = cleaned_terms
                else:
                    logger.info(f"No valid terms found for category: {category}")


            logger.info(f"Cleaned analysis result: {json.dumps(cleaned_result, indent=2)}")


            if not cleaned_result:
                logger.warning("No valid features found in the analysis")
                return {}

            return cleaned_result

        except Exception as e:
            logger.error(f"GPT analysis failed: {str(e)}", exc_info=True)
            return {}

    def generate_image(
        self,
        prompt: str,
        model: str = "dall-e-2",
        size: str = "1024x1024",
        quality: str = "standard",
    ) -> Dict[str, Any]:
        """生成图像 - 支持 DALL-E 和本地 Stable Diffusion"""
        try:
            logger.info(f"Generating image with model: {model}, prompt: {prompt}")

            if model in ["dall-e-2", "dall-e-3"]:

                response = self.client.images.generate(
                    model=model,
                    prompt=prompt,
                    size=size,
                    quality=quality,
                    n=1
                )
                image_url = response.data[0].url

            elif model == "stable-diffusion":

                if not self.sd_available:
                    raise ValueError("Stable Diffusion is not available. Please install with: pip install diffusers transformers accelerate")


                if size not in ["512x512", "768x768", "512x768", "768x512", "1024x1024"]:
                    logger.info(f"Adjusting size from {size} to 512x512 for Stable Diffusion")
                    size = "512x512"

                image_url = self._generate_with_stable_diffusion_local(prompt, size)

            else:
                raise ValueError(f"Unsupported model: {model}. Supported models: dall-e-2, dall-e-3, stable-diffusion")

            return {
                'success': True,
                'url': image_url,
                'prompt': prompt,
                'metadata': {
                    'model': model,
                    'size': size,
                    'quality': quality,
                    'timestamp': datetime.now().isoformat()
                }
            }

        except Exception as e:
            logger.error(f"Image generation failed: {str(e)}")
            return {
                'success': False,
                'error': str(e)
            }

    def interpolate_features(self, features: Dict[str, Any], weights: Dict[str, float], model: str = "dall-e-3", size: str = "1024x1024", quality: str = "standard") -> Dict[str, Any]:
        """特征插值 - 支持所有模型"""
        try:

            feature_analyses = {}
            feature_prompts = []

            for feature_id, feature_data in features.items():
                weight = weights.get(feature_id, 0)
                if weight <= 0:
                    continue


                source_features = feature_data.get('features', {})
                source_prompt = feature_data.get('sourcePrompt', '')
                feature_analyses[feature_id] = source_features


                feature_desc = ", ".join([f"{k} ({v:.0%})" for k, v in source_features.items()])
                feature_prompts.append(f"{feature_desc} with weight {weight:.0%}")


            combined_prompt = (
                f"Create an image combining these features: {'; '.join(feature_prompts)}. "
                f"Original elements from: {', '.join(set(data.get('sourcePrompt', '') for data in features.values()))}"
            )


            result = self.generate_image(
                prompt=combined_prompt,
                model=model,
                size=size,
                quality=quality
            )

            if not result.get('success'):
                raise Exception(result.get('error', 'Failed to generate image'))


            analysis_result = self.analyze_features(combined_prompt)
            if not analysis_result.get('success'):
                logger.warning("Feature analysis failed, using empty analysis")
                analysis_result = {'analysis': {}}

            return {
                'success': True,
                'url': result['url'],
                'prompt': combined_prompt,
                'analysis': analysis_result['analysis'],
                'source_analyses': feature_analyses,
                'weights': weights,
                'metadata': {
                    'model': model,
                    'size': size,
                    'quality': quality
                }
            }

        except Exception as e:
            logger.error(f"Feature interpolation failed: {str(e)}")
            return {
                'success': False,
                'error': str(e)
            }

    def enhance_prompt(self, prompt: str) -> Dict[str, Any]:
        """增强提示词"""
        try:
            completion = self.client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": "Enhance this image generation prompt to add more detail and clarity while maintaining the original intent."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.7
            )

            enhanced_prompt = completion.choices[0].message.content.strip()

            return {
                'success': True,
                'prompt': enhanced_prompt,
                'original_prompt': prompt
            }
        except Exception as e:
            return {
                'success': False,
                'error': str(e)
            }

    def analyze_image_with_clip(self, image_data: bytes, existing_features: Dict[str, Dict[str, float]]) -> Dict:
        """使用 CLIP 分析图像特征"""
        if not self.clip_model:
            logger.warning("CLIP model not available")
            return {}

        try:
            image = self._prepare_image(image_data)
            image_features = self._get_image_features(image)

            final_result = {}

            for category, terms in existing_features.items():
                if not isinstance(terms, dict):
                    continue

                term_list = list(terms.keys())
                if not term_list:
                    continue


                text_prompts = [f"This image shows {t} {category}" for t in term_list]
                text_inputs = self.clip_processor(
                    text=text_prompts,
                    return_tensors="pt",
                    padding=True
                ).to(self.device)

                with torch.no_grad():
                    text_features = self.clip_model.get_text_features(**text_inputs)
                    text_features = text_features / text_features.norm(dim=-1, keepdim=True)


                similarity = (100.0 * image_features @ text_features.T).softmax(dim=-1)
                scores = similarity[0].cpu().numpy()


                category_result = {}
                for i, term in enumerate(term_list):
                    score = float(scores[i])
                    if score > 0.2:
                        category_result[term] = score

                if category_result:
                    final_result[category] = category_result

            return final_result

        except Exception as e:
            logger.error(f"CLIP analysis failed: {str(e)}")
            return {}

    def _prepare_image(self, image_data):
        """准备图像数据"""
        try:
            if isinstance(image_data, str) and image_data.startswith('data:image'):
                image_data = image_data.split(',')[1]
                image_bytes = base64.b64decode(image_data)
            elif isinstance(image_data, str):
                image_bytes = base64.b64decode(image_data)
            else:
                image_bytes = image_data

            return Image.open(BytesIO(image_bytes)).convert('RGB')

        except Exception as e:
            logger.error(f"Image preparation failed: {str(e)}")
            raise

    def _get_image_features(self, image):
        """获取图像特征"""
        inputs = self.clip_processor(images=image, return_tensors="pt").to(self.device)
        with torch.no_grad():
            features = self.clip_model.get_image_features(**inputs)
            return features / features.norm(dim=-1, keepdim=True)

    def get_feature_types(self) -> Dict[str, Dict[str, Any]]:
        """获取特征类型定义"""
        return {
            feat_id: {
                'label': info['name'],
                'descriptors': info['descriptors']
            }
            for feat_id, info in self.feature_types.items()
        }

    def get_available_models(self) -> List[str]:
        """获取可用的模型列表"""
        models = ["dall-e-2", "dall-e-3"]
        if self.sd_available:
            models.append("stable-diffusion")
        return models

    def _get_from_cache(self, key: str) -> Optional[Dict]:
        """从缓存获取数据"""
        if hasattr(self, '_cache') and key in self._cache:
            result, timestamp = self._cache[key]
            if datetime.now().timestamp() - timestamp < 300:
                return result
            del self._cache[key]
        return None

    def _add_to_cache(self, key: str, value: Dict):
        """添加到缓存"""
        if not hasattr(self, '_cache'):
            self._cache = {}
        self._cache[key] = (value, datetime.now().timestamp())

    def _handle_error(self, error: Exception, context: str) -> Dict[str, Any]:
        """错误处理"""
        error_message = str(error)
        logger.error(f"Operation failed in {context}: {error_message}", exc_info=True)

        return {
            'success': False,
            'error': error_message,
            'error_type': error.__class__.__name__,
            'context': context,
            'timestamp': datetime.now().isoformat()
        }

    def _combine_analyses(self, gpt_analysis: Dict, clip_scores: Dict) -> Dict:
        """合并GPT和CLIP分析结果"""
        combined = {}

        for feature_type, features in gpt_analysis.items():
            if feature_type not in combined:
                combined[feature_type] = {}
            combined[feature_type].update(features)

        if clip_scores:
            for feature_type, features in clip_scores.items():
                if feature_type not in combined:
                    combined[feature_type] = {}
                combined[feature_type].update(features)

        return combined