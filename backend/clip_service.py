import torch
import clip
from PIL import Image
import requests
from io import BytesIO
import numpy as np
from typing import Dict, List, Tuple, Optional, Any
import logging
from dataclasses import dataclass
from transformers import CLIPProcessor, CLIPModel
import base64
import json

logger = logging.getLogger(__name__)

@dataclass
class ClipFeatureAnalysis:
    features: Dict[str, Dict[str, float]]
    raw_features: np.ndarray
    similarity_scores: Dict[str, float]
    feature_embeddings: Dict[str, np.ndarray]

class CLIPService:
    def __init__(self):
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.model = CLIPModel.from_pretrained("openai/clip-vit-base-patch32")
        self.processor = CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32")
        self.model.to(self.device)
        self._cache = {}
        self.feature_types = {
            'color': {'name': 'Color', 'descriptors': []},
            'style': {'name': 'Style', 'descriptors': []},
            'composition': {'name': 'Composition', 'descriptors': []},
            'lighting': {'name': 'Lighting', 'descriptors': []},
            'mood': {'name': 'Mood', 'descriptors': []},
            'texture': {'name': 'Texture', 'descriptors': []},
            'perspective': {'name': 'Perspective', 'descriptors': []},
            'detail': {'name': 'Detail', 'descriptors': []},
            'medium': {'name': 'Medium', 'descriptors': []}
        }

    def analyze_features(self, prompt: str, image_data: Optional[bytes] = None) -> Dict[str, Any]:
        try:

            prompt_features = self.analyze_prompt_with_gpt(prompt)


            for category, terms in prompt_features.items():
                if category in self.feature_types:
                    self.feature_types[category]['descriptors'] = list(terms.keys())


            if image_data:
                image_features = self.analyze_image_with_clip(image_data, prompt_features)

                for category, features in image_features.items():
                    prompt_features.setdefault(category, {}).update(features)

            return {
                'success': True,
                'features': prompt_features,
                'active_categories': [cat for cat, feat in prompt_features.items() if feat]
            }

        except Exception as e:
            logger.error(f"Feature analysis failed: {str(e)}")
            return {
                'success': False,
                'error': str(e)
            }


    def analyze_prompt_with_gpt(self, prompt: str) -> Dict:
        """
        Analyze the prompt using GPT to extract visual descriptors and features.

        Args:
            prompt (str): The input prompt to analyze

        Returns:
            Dict: Analysis results with categories and confidence scores
        """
        try:
            system_prompt = """
            Analyze the visual elements in the prompt and extract key descriptive terms for these categories:
            color, style, composition, lighting, mood, texture, perspective, detail, medium.

            For each identified term:
            1. Assign it to the most appropriate category
            2. Provide a confidence score (0-1) indicating how strongly it's expressed
            3. Only include terms that are explicitly mentioned or strongly implied
            4. Focus on artistic and visual characteristics
            5. Be specific and precise in terminology

            Return as JSON in the format:
            {
                "category": {
                    "descriptive_term": confidence_score
                }
            }

            Example:
            {
                "color": {
                    "vibrant": 0.9,
                    "blue-tinted": 0.7
                },
                "style": {
                    "impressionistic": 0.8
                }
            }
            """

            completion = self.client.chat.completions.create(
                model="gpt-4",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.3,
                max_tokens=1000
            )


            try:
                analysis = json.loads(completion.choices[0].message.content.strip())


                if not isinstance(analysis, dict):
                    raise ValueError("Invalid analysis structure")


                cleaned_analysis = {}
                for category, terms in analysis.items():
                    if isinstance(terms, dict) and terms:
                        cleaned_terms = {
                            str(term): float(score)
                            for term, score in terms.items()
                            if isinstance(score, (int, float)) and 0 <= score <= 1
                        }
                        if cleaned_terms:
                            cleaned_analysis[category] = cleaned_terms

                return cleaned_analysis

            except json.JSONDecodeError:
                logger.error("GPT returned invalid JSON format")
                return {}

        except Exception as e:
            logger.error(f"GPT analysis failed: {str(e)}")
            return {}

    def _get_descriptors(self, category: str) -> List[str]:
        """获取特定类别的当前描述词"""
        return self.feature_types[category]['descriptors']

    def analyze_image_with_clip(self, image_data: str) -> Dict:
        try:

            image = self._prepare_image(image_data)


            inputs = self.processor(
                images=image,
                return_tensors="pt"
            ).to(self.device)

            with torch.no_grad():
                image_features = self.model.get_image_features(**inputs)
                normalized_features = image_features / image_features.norm(dim=-1, keepdim=True)


            descriptors = self._get_descriptors()
            text_features = self._get_text_features(descriptors)


            similarity = self._calculate_similarity(normalized_features.cpu().numpy(), text_features)


            feature_map = {}
            for category, desc_list in descriptors.items():
                scores = similarity[category]
                feature_map[category] = {
                    desc: float(score)
                    for desc, score in zip(desc_list, scores)
                    if score > 0.2
                }

            return feature_map

        except Exception as e:
            logger.error(f"CLIP analysis failed: {str(e)}", exc_info=True)
            return {}


    def encode_text(self, text: str) -> Dict[str, Any]:
        try:
            inputs = self.processor(
                text=[text],
                return_tensors="pt",
                padding=True
            ).to(self.device)

            with torch.no_grad():
                text_features = self.model.get_text_features(**inputs)
                normalized_features = text_features / text_features.norm(dim=-1, keepdim=True)


            descriptors = self._get_descriptors()
            text_embeddings = self._get_text_features(descriptors)
            similarity = self._calculate_similarity(normalized_features.cpu().numpy(), text_embeddings)


            feature_map = {}
            for category, desc_list in descriptors.items():
                scores = similarity[category]
                feature_map[category] = {
                    desc: float(score)
                    for desc, score in zip(desc_list, scores)
                    if score > 0.2
                }

            return feature_map

        except Exception as e:
            logger.error(f"Text encoding failed: {str(e)}")
            return {}


    def _prepare_image(self, image_data: str) -> Image.Image:
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

    async def encode_image(self, image_data: str):
        try:

            if isinstance(image_data, str) and image_data.startswith('data:image'):

                image_data = image_data.split(',')[1]

                image_bytes = base64.b64decode(image_data)
            else:
                image_bytes = image_data


            image = Image.open(BytesIO(image_bytes)).convert('RGB')

            inputs = self.processor(
                images=image,
                return_tensors="pt"
            )
            inputs = {k: v.to(self.device) for k, v in inputs.items()}

            with torch.no_grad():
                image_features = self.model.get_image_features(**inputs)
                normalized_features = image_features / image_features.norm(dim=-1, keepdim=True)

            return normalized_features.cpu().numpy()

        except Exception as e:
            logger.error(f"Image encoding failed: {str(e)}")
            raise


    def _get_text_features(self, descriptors: Dict[str, List[str]]) -> Dict[str, np.ndarray]:
        features = {}

        for category, desc_list in descriptors.items():
            inputs = self.processor(
                text=[f"This image has {desc} {category}" for desc in desc_list],
                return_tensors="pt",
                padding=True
            ).to(self.device)

            with torch.no_grad():
                text_features = self.model.get_text_features(**inputs)
                normalized = text_features / text_features.norm(dim=-1, keepdim=True)
                features[category] = normalized.cpu().numpy()

        return features

    def _calculate_similarity(self, image_features: np.ndarray, text_features: Dict[str, np.ndarray]) -> Dict[str, np.ndarray]:
        similarity = {}

        for category, features in text_features.items():
            scores = np.dot(image_features, features.T)[0]
            scores = np.exp(scores * 100) / np.sum(np.exp(scores * 100))
            similarity[category] = scores

        return similarity

    def _combine_features(self, text_features: Dict, image_features: Dict) -> Dict:
        combined = {}


        all_categories = set(text_features.keys()) | set(image_features.keys())

        for category in all_categories:
            combined[category] = {}


            if category in text_features:
                combined[category].update(text_features[category])


            if category in image_features:

                for feature, score in image_features[category].items():
                    if feature in combined[category]:
                        combined[category][feature] = max(combined[category][feature], score)
                    else:
                        combined[category][feature] = score

        return combined

    def combine_features(
        self,
        text_features: np.ndarray,
        image_features: np.ndarray
    ) -> np.ndarray:
        """Combine text and image features"""

        combined = text_features * 0.6 + image_features * 0.4

        return combined / np.linalg.norm(combined, axis=-1, keepdims=True)

    async def extract_features(
        self,
        features: np.ndarray
    ) -> Dict[str, Dict[str, float]]:
        """Extract and classify features from embeddings"""
        feature_categories = {}

        try:

            for category in ['color', 'style', 'composition', 'lighting',
                           'mood', 'texture', 'perspective', 'detail', 'medium']:

                category_queries = await self._generate_category_queries(category)
                category_embeddings = await self.encode_text(category_queries)


                similarity = self.calculate_similarity(features, category_embeddings)


                significant_features = self._extract_significant_features(
                    similarity,
                    category_queries,
                    threshold=0.2
                )

                if significant_features:
                    feature_categories[category] = significant_features

        except Exception as e:
            logger.error(f"Feature extraction failed: {str(e)}")
            raise

        return feature_categories

    async def _generate_category_queries(self, category: str) -> str:
        """Generate relevant queries for each feature category"""

        system_prompt = f"""
        Generate a list of key visual descriptors for the {category} category.
        Focus on terms that CLIP would be able to recognize and compare.
        """

        try:
            response = await self.client.chat.completions.create(
                model="gpt-4",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": f"Generate descriptors for {category}"}
                ],
                temperature=0.3
            )

            return response.choices[0].message.content.strip()

        except Exception as e:
            logger.error(f"Query generation failed: {str(e)}")

            return f"This image shows {category}"

    def calculate_similarity(self, features, category_embeddings):

        if hasattr(features, '__await__'):
            raise ValueError("Features must not be a coroutine")
        if hasattr(category_embeddings, '__await__'):
            raise ValueError("Category embeddings must not be a coroutine")

        return np.dot(features, category_embeddings.T)


    def _extract_significant_features(
        self,
        similarity: np.ndarray,
        queries: List[str],
        threshold: float = 0.2
    ) -> Dict[str, float]:
        """Extract features with significant similarity scores"""
        significant_features = {}


        sorted_indices = np.argsort(similarity.flatten())[::-1]

        for idx in sorted_indices:
            score = similarity.flatten()[idx]
            if score < threshold:
                break

            feature = queries[idx]
            significant_features[feature] = float(score)

        return significant_features

    def calculate_similarity_scores(self, features: Dict) -> Dict[str, float]:
        """计算整体相似度分数"""
        scores = {}

        for category, feature_dict in features.items():
            if feature_dict:
                scores[category] = sum(feature_dict.values()) / len(feature_dict)
            else:
                scores[category] = 0.0

        return scores

    def get_feature_embeddings(
        self,
        features: np.ndarray
    ) -> Dict[str, np.ndarray]:
        """Get embeddings for different feature aspects"""
        return {
            'global': features,
            'normalized': features / np.linalg.norm(features, axis=-1, keepdims=True)
        }

    def _handle_error(self, error: Exception) -> Dict[str, any]:
        """Unified error handling"""
        error_message = str(error)
        logger.error(f"CLIP operation failed: {error_message}", exc_info=True)

        return {
            'success': False,
            'error': error_message,
            'error_type': error.__class__.__name__
        }